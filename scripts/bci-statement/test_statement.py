"""Real-capture regression tests. Missing corpus is a failure, never a skip."""
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from statement import StatementError, card, extract_captures, main, money

CORPUS = Path(os.environ.get('BCI_CAPTURE_DIR', '/workspace/bci-daily-2026-10-02'))
SCRIPT = Path(__file__).with_name('statement.py')


class RealCaptures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = extract_captures(CORPUS, '2026-08-18', '2026-10-02',
                                     allow_incomplete_replay=True)
        cls.accounts = {a['id']: a for a in cls.result['accounts']}

    def row(self, account, day, amount, name):
        matches = [m for m in self.accounts[account]['movements']
                   if (m['date'], m['amount'], m['name']) == (day, amount, name)]
        self.assertEqual(len(matches), 1, (account, day, amount, name))
        self.assertIn(matches[0]['source'], self.result['sources_sha256'])
        self.assertGreater(matches[0]['row'], 0)

    def test_all_five_balances_and_real_row_counts(self):
        expected = {
            'bci_checking_clp': ('2484842', 25),
            'bci_card_clp': ('-248236', 77),
            'bci_card_usd': ('-193.46', 30),
            'lider_card_clp': ('1003523', 9),
            'lider_card_usd': ('522.40', 0),
        }
        self.assertEqual(set(self.accounts), set(expected))
        for key, (balance, count) in expected.items():
            self.assertEqual(self.accounts[key]['available'], balance)
            self.assertEqual(len(self.accounts[key]['movements']), count)

    def test_current_account_original_descriptions(self):
        self.row('bci_checking_clp', '2026-10-02', '2484255', 'Transferencia recibida de GRUPO CF E HIJOS SPA')
        self.row('bci_checking_clp', '2026-10-02', '-19403', 'Cargo realizado por PAC de BCI SEGUROS VIDA SA')
        self.row('bci_checking_clp', '2026-09-07', '-500000', 'Pago Tarjeta De Credito Mastercard')
        self.row('bci_checking_clp', '2026-09-07', '500000', 'Transferencia recibida de RAIMUNDO MENA AGUIRRE')

    def test_pesos_original_descriptions_and_payment_signs(self):
        self.row('bci_card_clp', '2026-09-28', '280000', 'PAGOS NACIONAL WEB (Abono)')
        self.row('bci_card_clp', '2026-09-28', '-59980', 'MERPAGO*KAYAUNITE')
        self.row('bci_card_clp', '2026-09-28', '-5500', 'DL*GOOGLE YOUTUBE')
        self.row('bci_card_clp', '2026-09-30', '-1229990', 'TECNOMAS.CL')
        self.row('bci_card_clp', '2026-09-30', '1240000', 'MONTO CANCELADO')
        self.row('bci_card_clp', '2026-09-30', '-280000', 'AJUSTE PAGO DUPLICADO')
        self.row('bci_card_clp', '2026-09-26', '280000', 'Pago en Efectivo en Linea 9')
        self.row('bci_card_clp', '2026-09-08', '500000', 'MONTO CANCELADO')

    def test_dollars_use_bank_date_and_name(self):
        self.row('bci_card_usd', '2026-09-01', '-20.00', 'OPENAI')
        self.row('bci_card_usd', '2026-09-02', '1263.01', 'MONTO CANCELADO')
        self.row('bci_card_usd', '2026-09-23', '-33.62', 'cl-870425 partslink24  Muni')
        self.assertFalse(any(m['date'] == '2026-09-22' and m['amount'] == '-33.62'
                             for m in self.accounts['bci_card_usd']['movements']))

    def test_lider_preserves_statement_signs(self):
        for day, amount, name in [
            ('2026-10-01', '50992', 'SALCOBRAND APOQUINDO'),
            ('2026-09-30', '88534', 'LIDER DOMICILIO VENTAS Y DISTRIBUCION LTDA,'),
            ('2026-09-30', '4794', 'SPID APOQUINDO,SANTIAGO'),
            ('2026-09-30', '-383000', 'PAGO'),
            ('2026-09-29', '15800', 'GUACAMOLE OMNIUM,SANTIAGO'),
        ]:
            self.row('lider_card_clp', day, amount, name)

    def test_lider_usd_empty_is_explicit_and_scoped(self):
        account = self.accounts['lider_card_usd']
        self.assertTrue(account['explicit_empty'])
        self.assertEqual(account['movements'], [])
        self.assertIn('Por facturar', account['scope'])

    def test_filter_is_inclusive_and_uses_transaction_date(self):
        result = extract_captures(CORPUS, '2026-10-02', '2026-10-02',
                                  allow_incomplete_replay=True)
        self.assertEqual(len(result['accounts'][0]['movements']), 2)
        for a in result['accounts']:
            self.assertTrue(all(m['date'] == '2026-10-02' for m in a['movements']))

    def test_bad_periods_fail(self):
        for start, end in [('2026-10-03', '2026-10-02'), ('2026-02-30', '2026-10-02'),
                           ('2026-08-17', '2026-10-02'), ('2026-08-18', '2026-10-03')]:
            with self.subTest(start=start, end=end), self.assertRaises(StatementError):
                extract_captures(CORPUS, start, end)

    def test_wrong_card_and_currency_fail(self):
        path = CORPUS / 'personas/TC_1164_nacional_no_facturados.xls'
        with self.assertRaises(StatementError):
            card(path, str(path), 'CLP', False, '9015')
        with self.assertRaises(StatementError):
            card(path, str(path), 'USD', False)

    def test_money_rejects_nonfinite_and_excess_precision(self):
        for value in ('NaN', 'Infinity', '193.461', ''):
            with self.subTest(value=value), self.assertRaises(StatementError):
                money(value, 'USD')

    def test_late_failure_emits_no_partial_result(self):
        # Mutate only copies of the actual capture; never invent transaction rows.
        for failure in ('missing', 'blank', 'html-login-page', 'wrong-account', 'contradictory-empty'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                for rel in self.result['sources_sha256']:
                    target = root / rel
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(CORPUS / rel, target)
                target = root / 'lider/movimientos_internacionales_2026-10-02.csv'
                if failure == 'missing':
                    target.unlink()
                elif failure == 'blank':
                    target.write_text('')
                elif failure == 'html-login-page':
                    target.write_text('<html><form>Iniciar sesión</form></html>')
                elif failure == 'wrong-account':
                    target.write_text(target.read_text().replace('9015', '1164'))
                else:
                    target.write_text(target.read_text().replace(',,,,USD', '2026-10-02,,,,USD'))
                completed = subprocess.run([sys.executable, str(SCRIPT), '--captures', str(root),
                                            '--from', '2026-08-18', '--to', '2026-10-02'],
                                           text=True, capture_output=True)
                self.assertEqual(completed.returncode, 1)
                self.assertEqual(completed.stdout, '')
                self.assertIn('error', json.loads(completed.stderr))
                self.assertNotIn('accounts', completed.stderr)

    def test_default_rejects_unproven_period_coverage(self):
        for start in ('2026-08-18', '2026-10-02'):
            with self.subTest(start=start):
                with self.assertRaises(StatementError) as caught:
                    extract_captures(CORPUS, start, '2026-10-02')
                self.assertEqual(caught.exception.code, 'INCOMPLETE_COVERAGE')
                completed = subprocess.run(
                    [sys.executable, str(SCRIPT), '--captures', str(CORPUS),
                     '--from', start, '--to', '2026-10-02'], text=True, capture_output=True)
                self.assertEqual(completed.returncode, 1)
                self.assertEqual(completed.stdout, '')
                self.assertEqual(json.loads(completed.stderr)['error']['code'], 'INCOMPLETE_COVERAGE')

    def test_explicit_diagnostic_replay_serializes_once(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = main(['--captures', str(CORPUS), '--from', '2026-08-18', '--to', '2026-10-02',
                         '--allow-incomplete-replay'])
        self.assertEqual(code, 0)
        self.assertEqual(err.getvalue(), '')
        self.assertEqual(json.loads(out.getvalue()), self.result)
        self.assertIs(json.loads(out.getvalue())['complete'], False)


if __name__ == '__main__':
    unittest.main()
