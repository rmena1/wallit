"""Read paired Líder PDF statements using Poppler, preserving statement names/dates."""
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path


def date(value):
    return datetime.strptime(value, '%d/%m/%Y').date().isoformat()


def money(value):
    return Decimal(value.replace('.', '').replace(',', '.'))


def read(path):
    path = Path(path)
    text = subprocess.check_output(['pdftotext', '-layout', str(path), '-'], text=True)
    result = {}
    for currency in ['CLP', 'USD']:
        pages = [p for p in text.split('\f') if 'Número tarjeta' in p and
                 ('ESTADO DE CUENTA INTERNACIONAL' in p) == (currency == 'USD')]
        if not pages:
            raise ValueError('MISSING_CURRENCY')
        marks = [re.search(r'Página\s+(\d+) de (\d+)', p) for p in pages]
        if any(m is None for m in marks) or [(int(m[1]), int(m[2])) for m in marks] != [(i + 1, len(pages)) for i in range(len(pages))]:
            raise ValueError('INCOMPLETE_PAGES')
        joined = '\n'.join(pages)
        suffixes = set(re.findall(r'Número tarjeta\s+X+(\d{4})', joined))
        if len(suffixes) != 1 or (currency == 'CLP' and suffixes != {'9015'}):
            raise ValueError('WRONG_CARD')
        closing = set(re.findall(r'Fecha Estado de Cuenta (\d{2}/\d{2}/\d{4})', joined))
        if len(closing) != 1:
            raise ValueError('MIXED_STATEMENTS')
        if currency == 'CLP':
            bounds = re.search(r'Período Facturado\s+(\d{2}/\d{2}/\d{4})\s+(\d{2}/\d{2}/\d{4})', joined)
            start, end = date(bounds[1]), date(bounds[2])
            previous = money(re.search(r'Saldo Adeudado Final Período Anterior\s+\$\s*([\d.]+)', joined)[1])
            total = money(re.search(r'Monto Total Facturado[^\n]*\n\s*\$\s*([\d.]+)', joined)[1])
        else:
            start = date(re.search(r'Período facturado Desde\s+(\d{2}/\d{2}/\d{4})', joined)[1])
            end = date(re.search(r'Período facturado Hasta\s+(\d{2}/\d{2}/\d{4})', joined)[1])
            previous = money(re.search(r'Saldo Anterior Facturado US\$\s+([\d.,]+)', joined)[1])
            total = money(re.search(r'Deuda Total Facturada del Mes US\$\s+([\d.,]+)', joined)[1])
        rows = []
        for page_number, page in enumerate(pages, 1):
            for line_number, line in enumerate(page.splitlines(), 1):
                if currency == 'USD' and 'COMPROBANTE DE PAGO' in line:
                    break
                if currency == 'CLP':
                    match = re.search(r'(\d{2}/\d{2}/\d{4})\s+(.+?)\s{2,}\$\s*(-?[\d.]+)\s*$', line)
                    if not match:
                        continue
                    day, name, amount = match.groups()
                    # This layout has only the monthly charge column populated.
                    if '$' in name or re.search(r'\s{3,}\d', name):
                        raise ValueError('UNSUPPORTED_INSTALLMENT_LAYOUT')
                else:
                    match = re.search(r'(\d{2}/\d{2}/\d{4})\s+(.+?)\s{2,}(.+)$', line)
                    if not match:
                        continue
                    day, name, tail = match.groups()
                    amount = tail.split()[-1]
                    if not re.fullmatch(r'-?[\d.]+,\d{2}', amount):
                        continue
                rows.append({'date': date(day), 'name': name, 'amount': format(money(amount), '.2f' if currency == 'USD' else '.0f'),
                             'source': path.name, 'page': page_number, 'line': line_number, 'billing': 'billed'})
        if previous + sum((Decimal(r['amount']) for r in rows), Decimal(0)) != total:
            raise ValueError('STATEMENT_TOTAL_MISMATCH_' + currency)
        result[currency] = {'document_last_four': next(iter(suffixes)), 'from': start, 'to': end,
                            'billing_date': date(next(iter(closing))), 'previous_balance': str(previous),
                            'billed_total': str(total), 'reconciled': True, 'movements': rows}
    result['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


if __name__ == '__main__':
    try:
        print(json.dumps(read(sys.argv[1]), ensure_ascii=False, indent=2))
    except Exception:
        print('LIDER_PDF_VALIDATION_FAILED', file=sys.stderr)
        sys.exit(1)
