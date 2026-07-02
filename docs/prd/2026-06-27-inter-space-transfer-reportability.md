# PRD: Inter-Space Transfer reportability

## Contexto

Wallit modela los movimientos de dinero como filas en `movements` y las transferencias como una raíz explícita en `transfers` que vincula dos movimientos: una salida `expense` en la cuenta origen y una entrada `income` en la cuenta destino.

Hoy toda transferencia queda excluida de reportes porque `src/lib/domain/reporting.ts` aplica `NOT movementIsTransferSql()` dentro de `reportableMovementSqlFilters()`. Eso funcionaba para transferencias dentro del mismo Space —por ejemplo mover plata entre BCI y Mercado Pago—, pero queda corto para transferencias entre Spaces. En una transferencia `Personal → Casa`, la salida puede ser un gasto real para Personal y la entrada puede ser un ingreso/aporte real para Casa.

El glosario de dominio fue actualizado en `CONTEXT.md` y la decisión arquitectónica quedó registrada en `docs/adr/0003-reportable-inter-space-transfer-sides.md`: same-Space Transfers siguen siendo operacionales; Inter-Space Transfer sides pueden ser reportables independientemente.

## Objetivo

Permitir que las transferencias entre Spaces cuenten como gasto/ingreso por defecto, sin perder la flexibilidad de marcarlas como operacionales cuando solo deban afectar balances.

El resultado esperado es que una Inter-Space Transfer nueva nazca, por defecto, como:

- gasto reportable en el Space origen;
- ingreso reportable en el Space destino.

Cada lado debe poder desactivarse de reportes independientemente mediante controles claros tipo “Contar como gasto” y “Contar como ingreso”. El toggle nunca afecta balances: ambas patas siempre siguen moviendo plata en sus cuentas.

## Alcance

### Incluido

- Agregar soporte explícito de reportabilidad por lado de movimiento/transferencia.
- Mantener same-Space Transfers como operacionales y excluidas de reportes.
- Hacer que nuevas Inter-Space Transfers sean reportables por defecto en ambos lados.
- Permitir marcar cada lado de una Inter-Space Transfer como operacional durante creación, edición y revisión.
- Exigir categoría para cada lado reportable.
- No asignar categorías automáticamente.
- Mantener Inter-Space Transfers existentes como operacionales tras la migración.
- Permitir que la salida reportable de una Inter-Space Transfer sea marcada como gasto por cobrar, usando el mismo flujo semántico que un gasto normal por cobrar.
- Mantener prohibido dividir cualquier lado de una transferencia.
- Actualizar reportes, cashflow, timeline, detalle y review para respetar la nueva reportabilidad.
- Cubrir con tests de dominio, integración/server actions y E2E Playwright con screenshots.

### Excluido

- No se implementan reportes consolidados multi-Space. Si en el futuro existen, deberán evitar doble conteo de transferencias internas entre los Spaces consolidados.
- No se permite dividir una pata reportable de Inter-Space Transfer en varias categorías.
- No se permite marcar el lado incoming/income como gasto por cobrar.
- No se recalculan ni reclasifican automáticamente transferencias históricas.
- No se cambia la semántica de balances: toda transferencia sigue afectando balances siempre.
- No se crean categorías automáticas tipo “Aportes entre Spaces”.

## Arquitectura y Decisiones Técnicas

### 1. Reportabilidad debe vivir en `movements`, no solo en `transfers`

Agregar un campo explícito en `movements`, recomendado como:

```ts
reportable: boolean('reportable').notNull().default(true)
```

Rationale:

- La reportabilidad es una propiedad de cada lado, no del transfer root completo.
- `movements` ya concentra los hechos de reporte: `type`, `categoryId`, `receivable`, `emergency`, `loan`, etc.
- Permite que el mismo transfer tenga source reportable y destination operacional, o viceversa.
- Evita crear columnas dobles en `transfers` (`sourceReportable`, `destinationReportable`) que duplican información sobre movimientos.

Migración requerida:

- Movimientos normales existentes: `reportable = true` por defecto.
- Movimientos de cualquier transfer existente: `reportable = false`, para preservar comportamiento histórico.
- Same-Space Transfer sides existentes y futuras: `reportable = false`.
- Nuevas Inter-Space Transfer sides: `reportable = true` por defecto, salvo que el input diga explícitamente lo contrario.

### 2. El filtro central de reportes debe usar `movements.reportable`

Actualizar `src/lib/domain/reporting.ts`:

- Reemplazar la regla global `NOT movementIsTransferSql()` por `movements.reportable = true`.
- Mantener exclusiones existentes de receivables, emergency, loans, settlements y pending review según las reglas actuales.

Esto permite que:

- same-Space Transfers queden fuera porque sus sides tienen `reportable = false`;
- Inter-Space sides operacionales queden fuera porque tienen `reportable = false`;
- Inter-Space sides reportables entren a reportes como ingresos/gastos normales.

### 3. La creación/edición de transferencias debe aceptar clasificación por lado

Extender los inputs de `recordTransfer()` y `updateTransfer()` en `src/lib/actions/transfers.ts` y `src/lib/domain/movement-ledger.ts` con clasificación por lado:

```ts
type TransferSideClassificationInput = {
  reportable: boolean
  categoryId?: string | null
  receivable?: boolean
  receivableText?: string | null
}
```

Para creación manual:

- Si `destinationSpaceId === sourceSpaceId`, forzar ambos lados `reportable = false`, `categoryId = null`, `receivable = false`.
- Si `destinationSpaceId !== sourceSpaceId`, default:
  - source: `reportable = true`, `type = 'expense'`;
  - destination: `reportable = true`, `type = 'income'`.
- Si un lado reportable no trae `categoryId`, devolver error de validación.
- Si un lado operacional trae `categoryId`, ignorar/limpiar categoría.
- Solo source side puede traer `receivable = true`, y solo si source side es reportable.
- Destination side nunca puede ser receivable.

Para edición:

- Los hechos compartidos siguen siendo edición de la transferencia completa: fecha, monto, cuentas, Space destino, moneda y nota.
- La clasificación vive por lado: `reportable`, `categoryId`, `receivable`.
- Cambiar reportable → operacional debe limpiar `categoryId`.
- Cambiar reportable → operacional debe fallar si ese lado tiene dependencias, especialmente `receivable = true` o settlement asociado.
- Cambiar Inter-Space → same-Space debe hacer ambos lados operacionales y limpiar clasificación/receivable, salvo que existan dependencias; si existen, bloquear.
- Cambiar same-Space → Inter-Space debe aplicar default gasto+ingreso y exigir categorías para lados que sigan reportables.
- Cambiar destination Space debe descartar clasificación del lado destination y exigir reclasificación si destination queda reportable. El lado source conserva clasificación si el source Space no cambia.

### 4. Review debe confirmar transferencias pendientes como una sola operación clasificada

`getPendingReviewMovements()` ya agrupa pending transfer roots y exige acceso a ambos Spaces con `transferCanReview`. Mantener esa forma.

Cambiar `confirmPendingTransfer()` para recibir clasificación por lado:

```ts
confirmPendingTransfer(transferId, {
  source: { reportable, categoryId, receivable, receivableText },
  destination: { reportable, categoryId }
})
```

Reglas:

- Confirmar requiere acceso a ambos Spaces.
- No permitir confirmar solo una pata.
- Si un lado queda reportable, debe tener categoría.
- Si un lado queda operacional, limpiar categoría.
- La transferencia deja `needsReview = false` en ambos movimientos solo si ambas patas quedan resueltas.
- Si viene de cron/importador y no hay clasificación, permanece en review.

### 5. Receivable: permitir solo source side reportable de Inter-Space Transfer

Hoy `markAsReceivable()` rechaza cualquier transfer side por `await movementIsTransfer(movement.id)`. Cambiar esa regla:

- Seguir rechazando same-Space Transfers.
- Seguir rechazando destination/income transfer side.
- Permitir source side si:
  - pertenece a una Inter-Space Transfer;
  - `type = 'expense'`;
  - `reportable = true`;
  - no tiene dependencias previas;
  - no está ya `receivable`, `emergency` o `loan`.

El settlement/cobranza posterior debe usar los mismos flujos actuales de receivables; no crear flujo especial por venir de transferencia.

### 6. Split: seguir prohibido para transfer sides

`splitMovement()` debe seguir rechazando movimientos que son parte de una transferencia. Esto está alineado con la decisión de producto: una pata de transferencia reportable es una unidad contable única, no divisible en múltiples categorías.

## Modelo de Datos

### Nueva columna recomendada

En `movements`:

```ts
reportable: boolean('reportable').notNull().default(true)
```

### Migración

La migración debe ser explícita y preservar histórico:

1. Agregar columna con default `true`.
2. Setear `reportable = false` para todo movimiento que esté vinculado a una fila de `transfers` como source o destination.
3. Mantener `categoryId` existente para movimientos normales.
4. No intentar categorizar transferencias históricas.
5. Validar que no existan transferencias corruptas antes de asumir invariantes en operaciones nuevas.

SQL conceptual:

```sql
ALTER TABLE movements ADD COLUMN reportable boolean NOT NULL DEFAULT true;

UPDATE movements
SET reportable = false
WHERE id IN (
  SELECT source_movement_id FROM transfers
  UNION
  SELECT destination_movement_id FROM transfers
);
```

### Validaciones de consistencia

El ledger debe mantener estas invariantes:

- Same-Space Transfer side: `reportable = false`, `categoryId = null`, `receivable = false`.
- Operational Inter-Space side: `reportable = false`, `categoryId = null`, `receivable = false`.
- Reportable source Inter-Space side: `type = 'expense'`, `categoryId != null`, puede ser `receivable`.
- Reportable destination Inter-Space side: `type = 'income'`, `categoryId != null`, nunca `receivable`.
- `needsReview = false` solo si toda clasificación requerida está completa.

## API / Acciones

### `src/lib/actions/transfers.ts`

Extender `CreateTransferParams` para incluir clasificación opcional:

```ts
interface CreateTransferParams {
  fromAccountId: string
  toAccountId?: string | null
  destinationSpaceId?: string
  fromAmount: number
  toAmount: number
  fromCurrency: 'CLP' | 'USD'
  toCurrency: 'CLP' | 'USD'
  date: string
  note?: string
  sourceClassification?: TransferSideClassificationInput
  destinationClassification?: TransferSideClassificationInput
}
```

Defaults se aplican en ledger, no en UI solamente. Esto es clave para que cron/importadores hereden la regla correcta.

### `src/lib/domain/movement-ledger.ts`

Actualizar:

- `TransferInput`
- `recordTransfer()`
- `updateTransfer()`
- `transformToTransfer()` / `confirmPendingAsTransfer()`
- `confirmPendingTransfer()`
- `markAsReceivable()`
- helpers de transferencia para detectar:
  - same-Space vs Inter-Space;
  - source side vs destination side;
  - dependencia que bloquea reportable → operacional.

Agregar helpers recomendados:

```ts
async function getTransferByMovementId(movementId: string)
function isInterSpaceTransfer(transfer: Transfer): boolean
function isSourceSide(transfer: Transfer, movementId: string): boolean
function validateTransferSideClassification(...)
function movementHasBlockingReportabilityDependencies(...)
```

### `src/lib/actions/review.ts`

Actualizar `confirmPendingTransfer()` para recibir clasificación por lado y pasarla al ledger.

Actualizar `getPendingReviewMovements()` para exponer:

- `reportable` de cada leg;
- `categoryId` de cada leg;
- `receivable`/`received` del source leg;
- enough metadata to render category controls for both Spaces.

### Categorías por Space

Crear una acción/helper para traer categorías de todos los Spaces accesibles relevantes, por ejemplo:

```ts
getCategoriesForSpaces(spaceIds: string[]): Promise<Record<string, Category[]>>
```

Usar en Add, Edit Transfer y Review para mostrar categoría del Space origen y del Space destino.

## UI / UX

### Add transfer (`src/app/(app)/add/add-client.tsx`)

Cuando `type === 'transfer'`:

- Detectar si es same-Space o Inter-Space según `destinationSpaceId`.
- Same-Space:
  - No mostrar categorías ni toggles de gasto/ingreso.
  - Mostrar texto: “Las transferencias dentro del mismo Space solo afectan balances.”
- Inter-Space:
  - Mostrar sección “Clasificación para reportes”.
  - Source side:
    - Toggle default ON: “Contar como gasto”.
    - Helper: “Siempre afecta el balance; este toggle solo cambia reportes.”
    - Si ON: selector de categoría del Space origen obligatorio.
    - Si ON: opción “Gasto por cobrar” con input de persona/deudor, mismo copy que gasto normal por cobrar.
    - Si OFF: ocultar/limpiar categoría y receivable.
  - Destination side:
    - Toggle default ON: “Contar como ingreso”.
    - Helper equivalente.
    - Si ON: selector de categoría del Space destino obligatorio.
    - Si OFF: ocultar/limpiar categoría.
    - Nunca mostrar receivable.

### Edit transfer (`src/app/(app)/edit/[id]/edit-transfer-client.tsx`)

- Mostrar ambos lados con contexto de Space/cuenta/monto.
- Mostrar badges:
  - “Cuenta como gasto” / “Operacional” para source.
  - “Cuenta como ingreso” / “Operacional” para destination.
- Permitir cambiar toggles y categorías según reglas.
- Si hay receivable/dependencias que bloquean apagar reportabilidad, deshabilitar toggle y mostrar motivo claro.
- Si cambiar destination Space invalida categoría destino, limpiar selección y exigir nueva categoría si destination reportable queda ON.
- Si se convierte a same-Space, ocultar clasificación y advertir que se limpiará reportabilidad, salvo bloqueo por dependencias.

### Review (`src/app/(app)/review/review-client.tsx`)

Para pending Inter-Space Transfer:

- Mantener una sola tarjeta “Transferencia pendiente”.
- Mostrar ambos lados.
- Mostrar toggles “Contar como gasto” y “Contar como ingreso”, default ON si vienen sin clasificación completa.
- Exigir categorías para lados reportables.
- Confirmar con una sola acción.
- Si falta acceso a ambos Spaces, bloquear confirmación con mensaje actual: “Necesitas acceso a ambos Spaces para revisar esta transferencia.”

Para transformar un pending movement en transferencia:

- Si destination Space es distinto del current Space, tratar como Inter-Space.
- Default source reportable ON y destination reportable ON.
- Exigir categorías para lados reportables antes de confirmar.
- Si same-Space, mantener transferencia operacional sin categorías.

### Timeline / detalle / reportes visuales

- Una Inter-Space Transfer reportable debe sumar como gasto/ingreso normal en reportes y cashflow.
- En timeline y detalle debe conservar contexto de transferencia:
  - “Transferencia a Casa · cuenta como gasto”
  - “Transferencia desde Personal · cuenta como ingreso”
  - “Transferencia a Casa · operacional”
- No esconder el `transferId` ni cambiar navegación: sigue abriendo el detalle de transferencia.

## Criterios de Aceptación

- [ ] Las transferencias same-Space nuevas se crean con ambos lados `reportable = false`, sin categoría, y no aparecen en reportes de ingresos/gastos.
- [ ] Las Inter-Space Transfers nuevas se crean por defecto con source reportable como gasto y destination reportable como ingreso.
- [ ] En creación manual de Inter-Space Transfer, si source reportable está ON, la categoría del Space origen es obligatoria.
- [ ] En creación manual de Inter-Space Transfer, si destination reportable está ON, la categoría del Space destino es obligatoria.
- [ ] Si un lado se marca operacional en creación, no exige categoría y queda excluido de reportes, pero sigue afectando balance.
- [ ] Las Inter-Space Transfers creadas por automatización/importador/cron defaultéan ambos lados como reportables; si falta clasificación, quedan `needsReview = true` y aparecen en Review.
- [ ] Review muestra una sola tarjeta por pending transfer root y confirma ambos lados en una operación.
- [ ] Review no permite confirmar una Inter-Space Transfer pendiente si el usuario no tiene acceso a ambos Spaces.
- [ ] Reportes incluyen Inter-Space sides reportables en totales, daily data, category spending y movement count.
- [ ] Reportes excluyen same-Space Transfers y lados operacionales de Inter-Space Transfers.
- [ ] Balances de cuentas no cambian por apagar/prender reportabilidad.
- [ ] Timeline/detalle muestra contexto de transferencia y estado reportable/operacional.
- [ ] Una salida reportable de Inter-Space Transfer puede marcarse como gasto por cobrar con el mismo flujo de receivable normal.
- [ ] Una entrada/income de Inter-Space Transfer no puede marcarse como receivable.
- [ ] Ningún lado de transferencia puede dividirse con split.
- [ ] Apagar reportabilidad limpia categoría y receivable solo cuando no hay dependencias; si hay receivable/settlement, la acción queda bloqueada con mensaje claro.
- [ ] Editar destination Space descarta categoría del destination side y exige reclasificación si destination reportable queda ON.
- [ ] Editar Inter-Space → same-Space limpia clasificación y deja ambos lados operacionales, salvo bloqueo por dependencias.
- [ ] Editar same-Space → Inter-Space aplica default gasto+ingreso y exige categorías para lados reportables.
- [ ] Transferencias históricas existentes quedan operacionales tras la migración y no alteran reportes pasados.
- [ ] Tests unitarios/integración cubren reglas de ledger y filtros de reporting.
- [ ] Tests E2E Playwright cubren creación, edición, review, reports y receivable con screenshots.

## Riesgos y Mitigaciones

- Riesgo: romper reportes al reemplazar `NOT transfer` por `reportable`.
  - Mitigación: tests específicos de `reportableMovementSqlFilters()` y report totals con mezcla de movimientos normales, same-Space transfers, Inter-Space reportables y operacionales.

- Riesgo: duplicar balances o excluir movimientos de balance por confundir reportabilidad con tipo de movimiento.
  - Mitigación: no usar `reportable` en queries de balance de cuenta; solo en reporting/cashflow semántico.

- Riesgo: categorías del Space destino no están disponibles en Add/Edit/Review.
  - Mitigación: agregar helper server-side para traer categorías por Space y pasar `categoriesBySpaceId` a clientes relevantes.

- Riesgo: dependencias de receivable quedan inconsistentes si se apaga reportability.
  - Mitigación: centralizar validación en ledger y bloquear reportable → operacional cuando existan workflows dependientes.

- Riesgo: importar/cron crea transferencias confirmadas sin categoría.
  - Mitigación: defaults y validación deben vivir en ledger; si falta categoría para un lado reportable automático, dejar ambos lados pendientes de review.

- Riesgo: UI se vuelve demasiado compleja en creación.
  - Mitigación: mostrar controles de clasificación solo para Inter-Space Transfers; same-Space mantiene flujo simple.

## Dependencias

- Migración de base de datos para `movements.reportable`.
- Actualización de tests de dominio/reporting existentes.
- Acceso a categorías de múltiples Spaces en server components/actions.
- Revisión visual con Impeccable/frontend-design para Add/Edit/Review si se modifican pantallas grandes.

## Estimación Total

16 puntos.

Sugerencia de corte si hay que reducir scope:

1. Implementar modelo de datos + ledger + reporting + creación manual.
2. Luego edición/review.
3. Luego receivable y polish visual.
