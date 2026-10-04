import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
from lider_pdf import read

CAPTURES = Path(os.environ.get('BCI_LIDER_CAPTURE_DIR', '/workspace/bci-movimientos/lider-live-2026-10-04'))


class LiderStatements(unittest.TestCase):
    def test_both_real_documents_reconcile_both_currencies(self):
        for month, counts in [('08', (44, 3)), ('09', (22, 2))]:
            result = read(CAPTURES / f'2026-{month}.pdf')
            for currency, count in zip(['CLP', 'USD'], counts):
                self.assertTrue(result[currency]['reconciled'])
                self.assertEqual(len(result[currency]['movements']), count)
                self.assertEqual(result[currency]['billing_date'], f'2026-{month}-27')
            self.assertEqual(result['CLP']['document_last_four'], '9015')

    def test_missing_real_charge_fails_reconciliation(self):
        path = CAPTURES / '2026-09.pdf'
        text = subprocess.check_output(['pdftotext', '-layout', str(path), '-'], text=True)
        text = '\n'.join(l for l in text.split('\n') if 'MERPAGO*THEELEPHANTCO' not in l)
        with patch('lider_pdf.subprocess.check_output', return_value=text):
            with self.assertRaisesRegex(ValueError, 'STATEMENT_TOTAL_MISMATCH_CLP'):
                read(path)

    def test_missing_page_is_rejected(self):
        path = CAPTURES / '2026-08.pdf'
        text = subprocess.check_output(['pdftotext', '-layout', str(path), '-'], text=True)
        pages = text.split('\f')
        with patch('lider_pdf.subprocess.check_output', return_value='\f'.join(pages[1:])):
            with self.assertRaisesRegex(ValueError, 'INCOMPLETE_PAGES'):
                read(path)

    def test_live_result_keeps_real_available_and_filters_statement_dates(self):
        result = json.loads((CAPTURES / 'resultado.json').read_text())
        clp, usd = result['accounts']
        self.assertEqual([len(clp['movements']), len(usd['movements'])], [37, 3])
        self.assertEqual([clp['available'], usd['available']], ['998667', '522.40'])
        self.assertFalse(result['acceptance']['matches_original_available'])
        for account in result['accounts']:
            self.assertTrue(account['coverage']['complete'])
            self.assertTrue(all('2026-08-18' <= r['date'] <= '2026-10-02' for r in account['movements']))
        self.assertEqual(clp['outside_requested_period_current'][0]['amount'], '4856')
        self.assertTrue(usd['current_view']['explicit_empty'])
        self.assertIn('NETFLIX.COM,866-5797172', [m['name'] for m in usd['movements']])

if __name__ == '__main__':
    unittest.main()
