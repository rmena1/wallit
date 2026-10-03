"""Parse only a fresh bank download, not the historical capture directory."""
import json
from pathlib import Path
import sys
from statement import StatementError, checking, card, workbook, field, iso_date
from card_pdf import historical_card

try:
    kind, filename, currency, state = sys.argv[1:]
    path = Path(filename)
    if kind == 'checking':
        available, movements = checking(path, 'bank-download')
        data = {'available': str(available), 'movements': movements}
    elif kind == 'card':
        name, available, movements = card(path, 'bank-download', currency, state == 'billed')
        rows = workbook(path)
        data = {'name': name, 'available': str(available) if available is not None else None,
                'movements': movements,
                'statement_period': {
                    'from': iso_date(field(rows, 'Fecha de inicio ', 'D', 'E')),
                    'billing_date': iso_date(field(rows, 'Fecha facturación', 'D', 'E'))}}
    elif kind == 'card-pdf':
        data = historical_card(path, currency)
    else:
        raise StatementError('INVALID_DOWNLOAD', 'Tipo de descarga desconocido')
    print(json.dumps(data, ensure_ascii=False, allow_nan=False))
except Exception:
    print(json.dumps({'error': 'INVALID_DOWNLOAD'}))
    sys.exit(1)
