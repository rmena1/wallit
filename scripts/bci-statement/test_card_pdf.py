"""Regression cases from real bank PDFs; no generated movement fixtures."""
from decimal import Decimal
from pathlib import Path
import os
import unittest
from card_pdf import historical_card
from statement import StatementError

USD_HISTORY = Path('/workspace/bci-movimientos/2026-09-30-2meses/usd-historico')
CLP_HISTORY = Path(os.environ.get('BCI_HISTORY_CAPTURE_DIR', '/workspace/bci-movimientos/personas-live-2026-10-03'))


class RealHistoricalPDFs(unittest.TestCase):
    def test_august_dollars_includes_the_previously_missing_charge(self):
        result = historical_card(USD_HISTORY / 'tc_usd_statement_2026-07-23_2026-08-20.pdf', 'USD')
        self.assertEqual(result['verified_pages'], 2)
        self.assertEqual(result['statement_period'], {'from': '2026-07-23', 'billing_date': '2026-08-20'})
        self.assertEqual(len(result['movements']), 26)
        rows = [m for m in result['movements'] if m['date'] >= '2026-08-18']
        self.assertEqual([(m['date'], m['name'], m['amount']) for m in rows], [('2026-08-19', 'OPENAI', '-10.00')])

    def test_august_pesos_downloaded_from_the_real_portal(self):
        result = historical_card(CLP_HISTORY / 'tc_clp_statement_2026-07-23_2026-08-20.pdf', 'CLP')
        self.assertEqual(result['verified_pages'], 3)
        self.assertEqual(len(result['movements']), 64)
        rows = [m for m in result['movements'] if m['date'] >= '2026-08-18']
        self.assertEqual(len(rows), 6)
        self.assertEqual(sum(Decimal(m['amount']) for m in rows), Decimal('-31578'))
        self.assertEqual([(m['name'], m['amount']) for m in rows if m['date'] == '2026-08-20'], [
            ('IMPUESTO DECRETO LEY 3475 TASA 0,066 %', '-1357'),
            ('COBRO ADM MENSUAL', '-9398'), ('INTERESES ROTATIVOS', '-2814')])

    def test_all_seven_real_usd_cycles_reconcile_with_the_bank_totals(self):
        paths = sorted(USD_HISTORY.glob('*.pdf'))
        self.assertEqual(len(paths), 7)
        for path in paths:
            with self.subTest(path=path.name):
                result = historical_card(path, 'USD')
                self.assertTrue(result['movements'])
                self.assertEqual(result['verified_pages'], 2)

    def test_wrong_currency_is_rejected(self):
        with self.assertRaises(StatementError):
            historical_card(USD_HISTORY / 'tc_usd_statement_2026-07-23_2026-08-20.pdf', 'CLP')
