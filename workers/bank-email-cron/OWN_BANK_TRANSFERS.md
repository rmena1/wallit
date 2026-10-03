# Transferencias bancarias propias

El cron reconoce comprobantes de transferencias de BCI, Tenpo, Mercado Pago y
MACHBANK cuyo destinatario/remitente es Raimundo Mena (Aguirre). Exige el asunto
y la plantilla bancaria, además de la autenticación verificada por Gmail; no
clasifica por encontrar el nombre en cualquier correo. Los comprobantes Tenpo
con `MenaAguirre` también se reconocen. Esta ruta determinista no depende del
clasificador ni selecciona categoría.

El nuevo contrato `kind: own-bank-transfer` conserva fecha, hora, monto CLP en
centavos, bancos, números explícitos o productos implícitos, y los identificadores
de las cuentas mapeadas. El API verifica banco, moneda, últimos cuatro dígitos y
acceso del usuario antes de usar un identificador de Wallit.

- BCI corriente 8080 y Tenpo vista 0146 se vinculan mediante el mapa existente.
- Rai confirmó que Mercado Pago 1058236991 (6991) es la cuenta existente de
  Wallit, cuyo 6969 era un placeholder. Wallit Operator actualiza esa misma cuenta.
  Mercado Pago y BCI pertenecen a Personal: el caso del 30 septiembre por
  $2.706.418 es una transferencia dentro del mismo Space, Personal → Personal.
  Queda anulada la atribución anterior de otro Space a Mercado Pago y su extensión
  a las demás operaciones con BCI. El API deriva los Spaces de las cuentas reales.
- Los avisos de envío de Mercado Pago omiten el número de origen; se vinculan a
  1058236991 por esta confirmación de Rai, no porque el correo muestre ese número.
- Tenpo 0146 pertenece a Casa. MACH principal sigue sin cuenta ni Space mapeados.
- Con ambos extremos mapeados, se crea el transfer root y sus dos lados usando
  las reglas existentes de Wallit para mismo Space o Spaces distintos.
- Sin ambos extremos, se guarda una transferencia en `own_bank_transfer_imports`
  con estado `pending_accounts`, visible en Revisión. No crea un gasto, ingreso,
  cuenta o Space, ni altera saldos hasta que se vinculen las cuentas. La vinculación
  automática posterior y un editor de estos registros no están implementados.

Cada aviso conserva su identidad RFC Message-ID en `own_bank_transfer_receipts`.
La deduplicación entre bancos exige fecha, monto, bancos, cuentas y hora con
segundos coincidentes. No usa el thread ni sólo monto/fecha/minuto. El par del
1 septiembre comparte 18:43:21. Cuando falta esa evidencia, sólo se deduplica por
referencia bancaria o identidad del correo. Referencias contradictorias del mismo
banco se detienen para revisión. El registro, los recibos y los lados contables se
confirman en una transacción, con exclusión por usuario para importaciones
concurrentes.

El pago BCI 8080 → TC 1164 del 26 septiembre queda fuera de esta nueva ruta.
Su tratamiento preexistente como pago de tarjeta no cambia. Tampoco cambian
los parsers de compras, PAC, sueldo o terceros. El correo MACH real no contiene
resultado DMARC: se acepta el DKIM alineado exacto que informa el primer resultado
de autenticación de Gmail, exclusivamente para mail.machbank.cl y cuando no hay
resultado DMARC; nunca para anular un fallo DMARC.

## Verificación reproducible

Los cuerpos y encabezados reales permanecen fuera de Git en el dataset privado
`/workspace/wallit-bank-email-dataset/own-bank-transfers`:
`emails.json`, `auth-headers.json` y `negatives.json`. Se obtuvieron mediante el
conector Gmail de rmena.ag@gmail.com. Los IDs en el test identifican los mensajes
concretos. El caso real del 30 septiembre cubre ahora el mismo Space, con el
mapeo de cuentas confirmado por Rai; los cuerpos de los correos no se modifican.

```sh
cd workers/bank-email-cron
npm ci
npm test
node run-tests.mjs --real-transfers /workspace/wallit-bank-email-dataset
```

La prueba de persistencia usa PostgreSQL local desechable, con migraciones aplicadas:

```sh
DATABASE_URL=postgresql://127.0.0.1:55439/wallit_own_transfers_test npm run db:migrate
node scripts/test-own-bank-transfers.mjs /workspace/wallit-bank-email-dataset postgresql://127.0.0.1:55439/wallit_own_transfers_test
```

Comprueba ambos órdenes, concurrencia y reintentos: los 11 avisos especificados
(incluido el extra) producen 10 transferencias, 9 vinculadas y 1 pendiente (MACH); el par
del caso 2 es una sola operación. El test aislado verifica montos, fechas,
cuentas y autenticación real, y regresiones de sueldo, compras, terceros y TC.
La persistencia verifica los dos lados del caso del 30 septiembre en Personal,
sin reportabilidad ni revisión por cruce de Spaces, y las reglas entre Personal
y Casa para Tenpo. No hay fixture PAC verificado en este conjunto.

La regresión de conciliación reutiliza los dos correos reales del caso 2 con un
abono Tenpo previamente importado como ingreso: comprueba rechazo tanto antes
como después de registrar el aviso BCI, sin modificar movimientos ni adjuntar
recibos al rechazar o reintentar. La comprobación del aviso individual también
se ejecuta cuando ya existe una transferencia coincidente. Antes de crear lados
nuevos, una coincidencia con un movimiento bancario previo en cuenta, dirección,
fecha, minuto y monto exige conciliación; no se usa para fusionarlo ni cambiar
su tipo. El caso 1 también verifica que una transferencia preexistente válida
pueda reutilizarse sin duplicar sus lados. Sólo varía el estado previo de la base:
no se fabrican correos.

## Activación

Aplicar la migración 0019 y desplegar la aplicación/API antes del worker. Los
cambios no despliegan ni reprocesan correos de producción por sí solos. El cursor
existente no retrocede: los casos históricos necesitan un reproceso explícito.
Si un correo ya estaba guardado como gasto/ingreso, el API detiene la importación
para reconciliarlo en lugar de crear también una transferencia. Un transfer root
preexistente del mismo aviso puede reutilizarse sin duplicar sus lados.
