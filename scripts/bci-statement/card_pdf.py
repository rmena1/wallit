"""Deterministic text reader for the bank's historical credit-card PDFs."""
import re
import subprocess
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from statement import require, money, iso_date, movement


def single(pattern, text):
    matches = re.findall(pattern, text, re.M)
    require(len(matches) == 1, 'Campo PDF ausente o ambiguo')
    return matches[0]


def historical_card(path, currency):
    require(Path(path).stat().st_size < 30_000_000, 'PDF demasiado grande')
    proc = subprocess.run(['pdftotext', '-layout', str(path), '-'], capture_output=True,
                          timeout=15, check=True)
    text = proc.stdout.decode('utf-8')
    pages = [p for p in text.split('\f') if p.strip()]
    require(0 < len(pages) <= 100, 'Cantidad de páginas PDF inesperada')
    for i, page in enumerate(pages, 1):
        counts = re.findall(r'^\s*(\d+) de (\d+)\s*$', page, re.M)
        require(counts == [(str(i), str(len(pages)))], 'Faltan páginas de la cartola PDF')
    title = 'INTERNACIONAL' if currency == 'USD' else 'NACIONAL'
    require(re.search(r'ESTADO DE CUENTA ' + title + r' DE TARJETA DE CR[ÉE]DITO', text), 'Moneda PDF incorrecta')
    card = single(r'N° DE TARJETA DE CR[ÉE]DITO\s+(X+\d{4})', text)
    require(card.endswith('1164'), 'Tarjeta PDF incorrecta')
    closing = iso_date(single(r'FECHA ESTADO DE CUENTA\s+(\d{2}/\d{2}/\d{4})', text))
    if currency == 'CLP':
        start, end = single(r'PERIODO FACTURADO\s+(\d{2}-\d{2}-\d{4})\s+(\d{2}-\d{2}-\d{4})', text)
    else:
        start = single(r'PER[ÍI]ODO FACTURADO DESDE\s+(\d{2}/\d{2}/\d{4})', text)
        end = single(r'PER[ÍI]ODO FACTURADO HASTA\s+(\d{2}/\d{2}/\d{4})', text)
    require(iso_date(end) == closing and iso_date(start) <= closing, 'Período PDF contradictorio')
    rows = []
    for page_no, page in enumerate(pages, 1):
        for line_no, line in enumerate(page.splitlines(), 1):
            if currency == 'CLP':
                if not re.search(r'\b\d{2}/\d{2}/\d{2}\b', line):
                    continue
                match = re.fullmatch(r'\s*(.*?)\s*(\d{2}/\d{2}/\d{2})\s+(\d{12})\s+(.*?)\s+\$\s*(-?[\d.]+)\s+\$\s*(-?[\d.]+)\s+(\d{2}/\d{2})\s+\$\s*(-?[\d.]+)\s*', line)
                require(match is not None, 'Fila nacional PDF no reconocida')
                city, date, reference, name, operation, total, installment, amount = match.groups()
                extra = {'operation_amount': str(money(operation, currency, chilean=True)),
                         'total_payable': str(money(total, currency, chilean=True)), 'installment': installment}
            else:
                if not re.search(r'\b\d{2}/\d{2}/\d{2}\b', line):
                    continue
                match = re.fullmatch(r'\s*\d{4}\s+(?:([A-Z0-9]{10,})\s+)?(\d{2}/\d{2}/\d{2})\s+(.*?)\s+(-?[\d.,]+)\s+(-?[\d.,]+)\s*', line)
                require(match is not None, 'Fila internacional PDF no reconocida')
                reference, date, description, original, amount = match.groups()
                location = re.fullmatch(r'(.*\S)\s{2,}(\S(?:.*?\S)?)\s{2,}([A-Z]{2})', description)
                if location:
                    name, city, country = location.groups()
                else:
                    require(not re.search(r'\s{2,}', description), 'Columnas internacionales ambiguas')
                    name, city, country = description, '', ''
                extra = {'country': country, 'original_amount': str(money(original, 'USD', chilean=True))}
            date = datetime.strptime(date, '%d/%m/%y').date().isoformat()
            rows.append(movement(date, name.strip(), -money(amount, currency, chilean=True),
                                 'bank-download-pdf', line_no, reference=reference or '', city=city.strip(),
                                 billing='billed', page=page_no, **extra))
    require(bool(rows), 'PDF sin movimientos verificables')
    if currency == 'CLP':
        totals = [money(single(r'\(' + code + r'\)\s*\$\s*(-?[\d.]+)', text), currency, chilean=True)
                  for code in ('B', 'C', 'D')]
    else:
        totals = [money(single(label + r'\s+US\$\s*(-?[\d.,]+)', text), currency, chilean=True)
                  for label in ('TOTAL DE PAGOS', 'TOTAL DE COMPRAS')]
        adjustments = re.findall(r'COMISIONES, OTROS CARGOS Y ABONOS A LA CUENTA\s+US\$\s*(-?[\d.,]+)', text)
        require(len(adjustments) <= 1, 'Resumen PDF ambiguo')
        totals.extend(money(value, currency, chilean=True) for value in adjustments)
    require(sum((Decimal(r['amount']) for r in rows), Decimal(0)) == -sum(totals),
            'El detalle PDF no cuadra con los totales de la cartola')
    return {'name': card, 'available': None, 'movements': rows,
            'statement_period': {'from': iso_date(start), 'billing_date': closing},
            'verified_pages': len(pages)}
