"""Read-only deterministic extraction of the supplied bank captures.

No Wallit, email, credential store, network or model dependencies.
Money is serialized as decimal strings (CLP pesos; USD dollars).
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import zipfile
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from xml.etree import ElementTree as ET


class StatementError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def require(condition, message):
    if not condition:
        raise StatementError('INVALID_CAPTURE', message)


def money(value, currency, *, chilean=False):
    text = str(value).strip()
    if chilean:
        require(bool(re.fullmatch(r'-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?', text)), 'Monto chileno inválido')
        text = text.replace('.', '').replace(',', '.')
    try:
        amount = Decimal(text)
        require(amount.is_finite(), 'Monto no finito')
        quantum = Decimal('1') if currency == 'CLP' else Decimal('.01')
        rounded = amount.quantize(quantum, rounding=ROUND_HALF_UP)
        # Bank Excel exports contain floating point residue, not extra cents.
        require(abs(amount - rounded) <= Decimal('0.00000001'), 'Precisión monetaria inesperada')
        return rounded
    except (InvalidOperation, ValueError):
        raise StatementError('INVALID_CAPTURE', 'Monto inválido') from None


def iso_date(value):
    for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y'):
        try:
            return datetime.strptime(str(value), fmt).date().isoformat()
        except ValueError:
            pass
    raise StatementError('INVALID_CAPTURE', 'Fecha inválida en la cartola')


NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def workbook(path):
    """Parse the actual OOXML contents, including files named .xls by BCI."""
    try:
        with zipfile.ZipFile(path) as z:
            require(sum(i.file_size for i in z.infolist()) < 30_000_000, 'Excel demasiado grande')
            wb = ET.fromstring(z.read('xl/workbook.xml'))
            sheets = wb.findall('m:sheets/m:sheet', NS)
            require(len(sheets) == 1, 'Se esperaba una única hoja de cartola')
            rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
            rid = sheets[0].attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
            targets = [r.attrib['Target'] for r in rels if r.attrib['Id'] == rid]
            require(len(targets) == 1, 'Hoja de Excel no identificada')
            target = targets[0]
            target = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            shared = []
            if 'xl/sharedStrings.xml' in z.namelist():
                for item in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
                    shared.append(''.join(t.text or '' for t in item.findall('.//m:t', NS)))
            rows = []
            for row in ET.fromstring(z.read(target)).findall('m:sheetData/m:row', NS):
                cells = {}
                for c in row.findall('m:c', NS):
                    col = re.match(r'[A-Z]+', c.attrib['r']).group()
                    v = c.find('m:v', NS)
                    value = v.text if v is not None else None
                    kind = c.get('t')
                    require(kind != 'e' and c.find('m:f', NS) is None, 'Celda con error o fórmula no admitida')
                    if kind == 's' and value is not None:
                        value = shared[int(value)]
                    elif kind == 'inlineStr':
                        value = ''.join(t.text or '' for t in c.findall('.//m:t', NS))
                    if value is not None:
                        cells[col] = value
                rows.append((int(row.attrib['r']), cells))
            return rows
    except StatementError:
        raise
    except (OSError, zipfile.BadZipFile, KeyError, IndexError, ValueError, ET.ParseError):
        raise StatementError('INVALID_CAPTURE', f'Excel ilegible: {Path(path).name}') from None


def field(rows, label, column='A', value_column='B'):
    values = [r.get(value_column) for _, r in rows if r.get(column) == label]
    require(len(values) == 1 and values[0] is not None, f'Campo ausente o ambiguo: {label}')
    return values[0]


def movement(day, name, amount, source, row, **extra):
    require(isinstance(name, str) and bool(name.strip()), 'Movimiento sin descripción')
    return {'date': iso_date(day), 'name': name, 'amount': str(amount),
            'source': source, 'row': row, **extra}


def checking(path, source):
    rows = workbook(path)
    require(field(rows, 'Últimos Movimientos', value_column='A') == 'Últimos Movimientos', 'Cartola corriente incorrecta')
    headers = [(n, r) for n, r in rows if r.get('A') == 'Fecha Transacción']
    require(len(headers) == 1, 'Cabecera de cuenta corriente ausente')
    header_n, header = headers[0]
    require(all(header.get(k) == v for k, v in {'B': 'Fecha Contable', 'C': 'Descripción', 'G': 'Cargo $', 'H': 'Abono $'}.items()), 'Columnas de corriente cambiaron')
    available = money(field(rows, 'Saldo Disponible', 'D', 'E'), 'CLP', chilean=True)
    movements = []
    for n, r in rows:
        if n <= header_n or not r:
            continue
        require(bool(r.get('A')), 'Fila de corriente incompleta')
        debit = money(r['G'], 'CLP', chilean=True) if r.get('G') else Decimal(0)
        credit = money(r['H'], 'CLP', chilean=True) if r.get('H') else Decimal(0)
        require(debit >= 0 and credit >= 0 and bool(debit) != bool(credit), 'Cargo/abono ambiguo en corriente')
        movements.append(movement(r['A'], r.get('C'), credit - debit, source, n, accounting_date=iso_date(r.get('B'))))
    require(bool(movements), 'Cartola corriente vacía sin confirmación del banco')
    return available, movements


UNBILLED_CREDITS = {'MONTO CANCELADO', 'PAGOS NACIONAL WEB (Abono)', 'Pago en Efectivo en Linea 9'}


def card(path, source, currency, billed, last_four='1164'):
    rows = workbook(path)
    card_name = field(rows, 'Tarjeta')
    require(card_name.endswith('****' + last_four), 'La tarjeta no corresponde a la cuenta solicitada')
    title = f'Movimientos {"nacionales" if currency == "CLP" else "internacionales"} {"facturados" if billed else "no facturados"}'
    require(sum(r.get('A') == title for _, r in rows) == 1, 'Moneda o estado de facturación incorrecto')
    headers = [(n, r) for n, r in rows if r.get('A') == 'Fecha']
    require(len(headers) == 1, 'Cabecera TC ausente')
    header_n, header = headers[0]
    require(all(header.get(k) == v for k, v in {'B': 'Código referencia', 'C': 'Ciudad', 'D': 'Descripción', 'E': 'Tipo de tarjeta', 'F': 'Monto ($)' if currency == 'CLP' else 'Monto (USD)'}.items()), 'Columnas TC cambiaron')
    available = None if billed else money(field(rows, 'Cupo disponible'), currency)
    movements = []
    for n, r in rows:
        if n <= header_n or not r:
            continue
        require(bool(r.get('A')) and bool(r.get('B')) and r.get('E', '').endswith('****' + last_four), 'Fila TC incompleta o de otra tarjeta')
        amount = money(r.get('F'), currency)
        name = r.get('D')
        # Billed amounts are already signed bank charges. Unbilled exports
        # encode known payments as positive magnitudes, like purchases.
        if not billed and name in UNBILLED_CREDITS:
            amount = abs(amount)
        else:
            amount = -amount
        movements.append(movement(r['A'], name, amount, source, n,
                                  reference=r['B'], city=r.get('C', ''),
                                  billing='billed' if billed else 'unbilled'))
    require(bool(movements), 'TC vacía sin confirmación explícita del banco')
    return card_name, available, movements


def lider_csv(path, source, currency):
    try:
        with path.open(newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            amount_key = 'monto_clp' if currency == 'CLP' else 'monto_usd'
            required = {'fecha', 'descripcion', 'cuotas', amount_key, 'moneda', 'origen', 'filtro'}
            require(required <= set(reader.fieldnames or []), 'Cabecera Líder cambió')
            rows = list(reader)
    except (OSError, UnicodeError, csv.Error):
        raise StatementError('INVALID_CAPTURE', 'CSV Líder ilegible') from None
    require(bool(rows), 'CSV Líder vacío sin confirmación del portal')
    movements = []
    empty = False
    for n, r in enumerate(rows, 2):
        require(None not in r and all(v is not None for v in r.values()), 'Fila CSV incompleta')
        require(r['moneda'] == currency and r['origen'] == 'Portal Lider Bci ****9015' and r['filtro'] == 'Por facturar', 'Identidad, moneda o filtro Líder incorrectos')
        if r.get('estado') == 'Sin movimientos para mostrar':
            require(len(rows) == 1 and not any(r[k] for k in ('fecha', 'descripcion', amount_key)), 'Estado vacío inconsistente')
            empty = True
            continue
        movements.append(movement(r['fecha'], r['descripcion'], money(r[amount_key], currency), source, n, billing='unbilled'))
    return movements, empty


def lider_balances(path):
    text = path.read_text(encoding='utf-8')
    require('****9015' in text and '2026-10-02' in text, 'Identidad/fecha del saldo Líder incorrecta')
    result = {}
    for currency, prefix in [('CLP', '$'), ('USD', 'US$')]:
        pattern = rf'^\| {currency} \([^|]+\) \| {re.escape(prefix)}([^|]+) \| {re.escape(prefix)}([^|]+) \| {re.escape(prefix)}([^|]+) \|$'
        found = re.findall(pattern, text, re.M)
        require(len(found) == 1, f'Saldo Líder {currency} ausente o ambiguo')
        total, used, available = [money(v.strip(), currency, chilean=True) for v in found[0]]
        require(total - used == available, f'Cupos Líder {currency} inconsistentes')
        result[currency] = available
    return result


def extract_captures(root, start, end, *, allow_incomplete_replay=False):
    start, end = iso_date(start), iso_date(end)
    require(start <= end, 'Período invertido')
    require('2026-08-18' <= start <= end <= '2026-10-02', 'Período fuera de la captura disponible (18/08–02/10/2026)')
    root = Path(root)
    sources = {}

    def source(relative):
        path = root / relative
        try:
            sources[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            raise StatementError('MISSING_CAPTURE', f'Falta la captura: {relative}') from None
        return path

    accounts = []

    def account(key, currency, last_four, available, movements, **extra):
        accounts.append({'id': key, 'last_four': last_four, 'currency': currency,
                         'available': str(available), 'available_as_of': '2026-10-02',
                         'movements': [m for m in movements if start <= m['date'] <= end], **extra})

    rel = 'personas/CC_ultimos_movimientos.xlsx'
    available, movements = checking(source(rel), rel)
    account('bci_checking_clp', 'CLP', '8080', available, movements,
            scope='Últimos Movimientos', identity_evidence='Capture assignment; checking export has no account number')
    for currency, part in [('CLP', 'nacional'), ('USD', 'internacional')]:
        movements = []
        available = None
        for billed in (True, False):
            rel = f'personas/TC_1164_{part}_{"facturados" if billed else "no_facturados"}.xls'
            name, balance, batch = card(source(rel), rel, currency, billed)
            movements.extend(batch)
            if balance is not None:
                available = balance
        account('bci_card_' + currency.lower(), currency, '1164', available, movements,
                name=name, scope='Facturados + no facturados de las capturas disponibles')
    balances = lider_balances(source('lider/saldos.md'))
    for currency, filename in [('CLP', 'movimientos_visibles_2026-10-02.csv'), ('USD', 'movimientos_internacionales_2026-10-02.csv')]:
        rel = 'lider/' + filename
        movements, empty = lider_csv(source(rel), rel, currency)
        account('lider_card_' + currency.lower(), currency, '9015', balances[currency], movements,
                scope='Por facturar; filas visibles capturadas', explicit_empty=empty)
    require(len(accounts) == 5, 'Extracción incompleta')
    # Parsing every supplied file does not establish full period coverage.
    # In particular, visible unbilled rows cannot prove billed history or
    # pagination completeness, even when the requested period is narrower.
    if not allow_incomplete_replay:
        raise StatementError(
            'INCOMPLETE_COVERAGE',
            'Las capturas de Líder sólo acreditan filas visibles de «Por facturar»; '
            'no acreditan todos los movimientos del período. '
            'No se emite un resultado parcial. '
            'Para inspección de las capturas, use --allow-incomplete-replay.')
    return {'mode': 'capture-replay', 'complete': False, 'period': {'from': start, 'to': end},
            'coverage': 'Only supplied captures; full portal history and live login are not verified',
            'amount_unit': 'CLP pesos / USD dollars; exact decimal strings',
            'signs': {'bci': 'credits positive, charges negative', 'lider': 'bank statement signs unchanged'},
            'accounts': accounts, 'sources_sha256': sources}


def main(argv=None):
    parser = argparse.ArgumentParser(description='Extrae las cinco cuentas de las capturas reales; no accede a Wallit.')
    parser.add_argument('--captures', type=Path, required=True)
    parser.add_argument('--from', dest='start', required=True)
    parser.add_argument('--to', dest='end', required=True)
    parser.add_argument('--allow-incomplete-replay', action='store_true',
                        help='Sólo diagnóstico: permite inspeccionar capturas sin cobertura completa; no valida la extracción bancaria.')
    args = parser.parse_args(argv)
    try:
        # Buffer the entire result; failures never emit accounts or movements.
        result = extract_captures(args.captures, args.start, args.end,
                                  allow_incomplete_replay=args.allow_incomplete_replay)
        serialized = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False)
    except StatementError as exc:
        print(json.dumps({'error': {'code': exc.code, 'message': str(exc)}}, ensure_ascii=False), file=sys.stderr)
        return 1
    except Exception:
        # Never leak underlying exceptions, source contents or environment.
        print(json.dumps({'error': {'code': 'CAPTURE_READ_FAILED', 'message': 'No se pudo leer la captura completa'}}), file=sys.stderr)
        return 1
    print(serialized)
    return 0


if __name__ == '__main__':
    sys.exit(main())
