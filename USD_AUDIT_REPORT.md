# 🔍 Auditoría USD — Wallit

## Convenciones de almacenamiento (correctas)
- `movements.amount` = **siempre CLP centavos** (incluso para movimientos USD, guarda el equivalente CLP)
- `movements.amountUsd` = USD centavos (solo para movimientos USD o en cuentas USD)
- `movements.exchangeRate` = tasa × 100 (ej: 908.57 CLP/USD → 90857)
- `accounts.initialBalance` = centavos en la moneda de la cuenta (USD cents para cuentas USD)
- `accounts.creditLimit` = centavos en la moneda de la cuenta

## ✅ Cosas que funcionan bien
1. **Schema**: bien diseñado, separación clara CLP/USD
2. **Balance de cuentas** (`getAccountBalances`): usa `amountUsd` para cuentas USD ✅
3. **Balance total** (home page): convierte USD a CLP con tasa ✅
4. **Account cards**: `formatCurrency(acc.balance, acc.currency)` ✅
5. **Exchange rate fetch/cache**: correcto, rate × 100 ✅
6. **createMovement**: convierte correctamente USD↔CLP ✅
7. **Transfers**: maneja correctamente USD/CLP ✅
8. **Balance history (account detail page)**: usa `amountUsd` para cuentas USD ✅

## 🐛 BUGS ENCONTRADOS

### BUG 1 — CRÍTICO: Home page muestra CLP centavos como USD
**Archivo:** `src/app/(app)/home-client.tsx:166`
```tsx
formatCurrency(m.amount, m.currency)
```
- `m.amount` = CLP centavos SIEMPRE
- `m.currency` puede ser 'USD'
- Resultado: un gasto de US$10 (con amount=908000 CLP centavos) se muestra como "US$9.080,00" 🔴
- Debería mostrar `amountUsd` formateado como USD

### BUG 2 — CRÍTICO: `amountUsd` no está en los queries del home ni en paginación
**Archivos:**
- `src/app/(app)/page.tsx` — query de movimientos recientes NO selecciona `amountUsd`
- `src/lib/actions/movements.ts:getMovementsPaginated` — NO selecciona `amountUsd`
- `src/app/(app)/home-client.tsx:MovementWithCategory` — interfaz NO incluye `amountUsd`

Sin `amountUsd` en los datos, es imposible mostrar USD correctamente.

### BUG 3 — CRÍTICO: Account detail muestra todos los montos como CLP
**Archivo:** `src/app/(app)/account/[accountId]/account-detail-client.tsx:264`
```tsx
formatCurrency(m.amount, 'CLP')  // ← HARDCODED 'CLP'
```
Para cuentas USD, debería mostrar `amountUsd` como USD.

### BUG 4 — MEDIO: Chart tooltip en account detail hardcodea CLP
**Archivo:** `src/app/(app)/account/[accountId]/account-detail-client.tsx`
```tsx
formatCurrency(point.balance, point.currency || 'CLP')
```
`point.currency` es `undefined` (BalancePoint no tiene currency). Para cuentas USD el balance está en USD centavos pero se muestra como CLP.

### BUG 5 — MENOR: Label "Monto pesos" en add form cuando currency=USD
**Archivo:** `src/app/(app)/add/add-client.tsx:544`
```tsx
<label>{currency === 'USD' ? 'Monto pesos' : 'Monto'}</label>
```
El label dice "Monto pesos" pero el código trata el input como USD centavos. Confuso.

### BUG 6 — MENOR: Unlinked incomes en payment dialog siempre muestra CLP
**Archivo:** `src/app/(app)/home-client.tsx`
```tsx
+{formatCurrency(inc.amount, 'CLP')}
```
Para incomes USD debería mostrar el monto USD.

## Plan de Fix

1. Agregar `amountUsd` a TODOS los queries de movimientos:
   - Home page query (page.tsx)
   - getMovementsPaginated (movements.ts)
   - Unlinked incomes query (page.tsx)

2. Actualizar interfaces TypeScript:
   - MovementWithCategory: agregar `amountUsd`
   - UnlinkedIncome: agregar `amountUsd`

3. Corregir display de montos en movimientos:
   - Home MovementCard: mostrar `amountUsd` como USD cuando currency='USD', sino `amount` como CLP
   - Account detail movements: usar currency de la cuenta y amountUsd
   - Unlinked incomes: usar amountUsd para USD

4. Corregir chart tooltip en account detail: pasar currency al balance point

5. Fix label del add form: "Monto (USD)" cuando currency=USD
