# BCI Personas y Líder: lector determinista

**Personas verificado mediante una corrida real para el 18/08–02/10/2026:** corriente ****8080, 25 movimientos y disponible 2484842; TC ****1164 CLP, 83 movimientos y disponible -248236; TC USD, 31 movimientos y disponible -193.46. El banco se navega exclusivamente mediante Node/Playwright, sin modelos. **Líder no se volvió a abrir; el alcance de cinco cuentas sigue sin validación completa por el Turnstile ya observado.**

## Ejecución de Personas

```sh
npm ci --prefix scripts/bci-statement
# Si Chromium no está instalado:
npm exec --prefix scripts/bci-statement -- playwright install chromium
node scripts/bci-statement/live.mjs --from 2026-08-18 --to 2026-10-02 --bank personas
```

También se admite `--headed`. Se requieren Python 3 y `pdftotext` (Poppler) para las cartolas históricas PDF. `--bank personas` exige únicamente `BCI_PERSONAS_RUT` y `BCI_PERSONAS_CLAVE` y nunca crea una sesión de Líder. El modo original, sin esa opción, conserva ambos bancos y exige además `BCI_LIDER_RUT` y `BCI_LIDER_CLAVE`; no está validado de punta a punta y no se ejecutó en esta ampliación. Las credenciales se reciben exclusivamente por entorno. Una variable requerida ausente falla antes de abrir Chromium.

El ejecutor descubre el acceso desde el sitio público, hace un solo envío de login por banco y usa un navegador propio y contextos nuevos. Intenta cerrar la sesión y cierra incondicionalmente contextos y navegador. Las descargas temporales tienen permisos privados y se eliminan al terminar. No persiste cookies, formularios, trazas ni credenciales. No accede a Wallit ni modifica cron.

Stdout contiene un JSON únicamente tras completar todas las cuentas del alcance solicitado y cerrar los recursos. Un fallo produce código 1, error por stderr y stdout vacío. El progreso contiene solamente etapas. `captured_at` indica cuándo se hizo la consulta; los disponibles se leen del banco y no se reemplazan por los valores esperados de una captura histórica.

## Caminos conservados y ampliados

- Login: acceso directo, selección de titular, entrega de sesión por JSON/formulario y la página alternativa de `login.bci.cl` que permite «Omitir» el registro explícitamente opcional del dispositivo. No se registra un dispositivo.
- Corriente: menú anterior Mi Banco → Mi Cuenta → Últimos Movimientos y resumen moderno con selección de ****8080 y acceso «Ir a Últimos Movimientos». Se conservan los controles de exportación anteriores y el icono `exportarExcel` del marco moderno.
- Tarjetas: menú directo y «Expandir Todo» cuando los enlaces están recortados. Si la carga queda en el selector de ****1164 sin crear las pestañas, se selecciona explícitamente esa tarjeta una sola vez. La corrida real reprodujo y superó ese estado. La ruta con pestañas ya disponibles continúa funcionando.
- Movimientos: Nacional/Internacional y Facturados/No facturados mantienen sus descargas Excel. El historial agrega Estado de cuenta y los períodos anteriores necesarios. La variante con opciones ISO devuelve el último Excel aunque se elija agosto; se usa su control «Revisar documento», cuyo PDF sí corresponde al ciclo seleccionado. Se valida la fecha de cierre de cada documento. No se modifica la petición del portal ni se acepta septiembre como evidencia de agosto.
- Los PDF se leen con `pdftotext`, sin OCR ni modelos. Se comprueban tarjeta, moneda, período, numeración de todas las páginas y suma de movimientos contra los totales bancarios. Se conservan descripción y fecha de operación, incluso espacios interiores. En CLP se toma el cargo mensual de la fila y se conservan también monto de operación, total e información de cuota.

Turnstile, reCAPTCHA, hCaptcha o «no soy un robot» terminan la sesión con error, sin resolverlos ni reintentar el login. Las pruebas de estos controles usan red completamente interceptada; no ingresan a Líder.

## Evidencia del período

La cobertura no se deduce de unas filas antiguas ni se toma del corpus local. Se obtiene en la misma sesión:

- Corriente: la respuesta bancaria declara `FECHA_TRANSACCION` y devuelve los 50 últimos movimientos. Se comprueba el orden y que el Excel contenga las mismas fechas con la misma multiplicidad. Se excluye el día más antiguo, porque el límite podría cortar otras operaciones de ese día. En la corrida verificada ese límite fue 03/07/2026, anterior al rango pedido.
- TC: se reúnen ciclos consecutivos de facturación y la vista vigente no facturada. El PDF histórico acredita 23/07–20/08; el Excel facturado, 21/08–17/09; el no facturado se contrasta con la fecha vigente entregada por el banco, 03/10. Las cantidades de filas de ambas vistas actuales deben coincidir con la respuesta del portal, sin indicadores de error. La salida identifica estos límites como `billing-cycle` y el filtro de movimientos como `transaction-date`: no los presenta como un filtro por fecha enviado al servidor.

La unión de esos documentos cubre los registros bancarios del período a la fecha de consulta. Las filas se filtran por la fecha que figura en la cartola. La cartola anterior añadió **seis filas CLP y una USD (OPENAI, 19/08, -10.00)**, que faltaban al consultar sólo facturados y no facturados actuales. Los documentos repetidos se combinan conservando la multiplicidad de filas.

`PERIOD_NOT_VERIFIED` o `PERIOD_NOT_COVERED` describen falta de evidencia o de alcance del lector, no un fallo de login del banco. Un error de página, descarga, identidad, período o cuadratura descarta todo el resultado. No existe fallback a las capturas locales.

## Pruebas y fuentes reales

```sh
npm test --prefix scripts/bci-statement
python3 -m unittest discover -s scripts/bci-statement -p 'test_*.py' -v
```

Los tests financieros usan las cartolas reales de `/workspace/bci-daily-2026-10-02/`, los siete PDF USD de `/workspace/bci-movimientos/2026-09-30-2meses/usd-historico/` y el PDF CLP de agosto descargado durante esta sesión, conservado fuera del repositorio en `/workspace/bci-movimientos/personas-live-2026-10-03/`. Esa carpeta también contiene `resultado.json`, la salida completa de la corrida real, usada para comprobar que quitar el ciclo de agosto vuelve a detectar el hueco de cobertura. Se admiten `BCI_CAPTURE_DIR` y `BCI_HISTORY_CAPTURE_DIR` para las ubicaciones de los corpus correspondientes. La ausencia de esos archivos falla; no se sustituyen por movimientos inventados.

Las pruebas de navegación conservan los caminos anteriores y cubren la selección intermedia de tarjeta, los controles de descarga, login rechazado, robot, HTTP 503, credenciales ausentes, eliminación de temporales y descarte de datos ante un fallo posterior. Sus páginas mínimas reproducen controles; no acreditan movimientos ni una corrida bancaria real. Las pruebas de aritmética de intervalos tampoco sustituyen esa corrida.

## Inspección histórica, independiente del ejecutor en línea

`statement.py` permite revisar los archivos entregados; no es el cierre de la automatización. La ejecución normal termina con `INCOMPLETE_COVERAGE` y stdout vacío porque las capturas no acreditan todo el período de Líder. La opción explícita `--allow-incomplete-replay` permite inspeccionar las cinco cuentas en un JSON de diagnóstico marcado `complete: false`.

```sh
python3 scripts/bci-statement/statement.py \
  --captures /workspace/bci-daily-2026-10-02 \
  --from 2026-08-18 --to 2026-10-02 --allow-incomplete-replay
```

Las pruebas Python requieren el corpus real. Para otra ubicación, usar `BCI_CAPTURE_DIR` al ejecutar las pruebas. La ausencia del corpus falla; no se reemplaza por movimientos sintéticos ni se omiten pruebas. Los archivos bancarios permanecen fuera del repositorio.

## Contrato de la inspección histórica

- Sin la opción de diagnóstico, cobertura no acreditada significa código 1, error `INCOMPLETE_COVERAGE` por stderr y stdout vacío. Esto también aplica a subperíodos: las filas visibles no demuestran paginación completa.
- Sólo con `--allow-incomplete-replay`, código 0 y un JSON de inspección por stdout. `mode: capture-replay` y `complete: false` distinguen esta salida de una extracción completa. El código 0 acredita únicamente la lectura de los archivos, no el cumplimiento del objetivo bancario. La API Python requiere igualmente `allow_incomplete_replay=True`.
- Ante archivo faltante, formato inesperado, cuenta/moneda incorrecta o error de lectura: código 1, error por stderr y stdout vacío. Se valida todo antes de emitir datos, incluso si el fallo ocurre en la quinta cuenta.
- `amount` y `available` son cadenas decimales exactas, en pesos CLP o dólares USD. No se usan centavos implícitos ni flotantes para operar montos.
- Para Personas: abonos positivos y cargos negativos. Los Excel no facturados publican magnitudes positivas para pagos; `MONTO CANCELADO`, `PAGOS NACIONAL WEB (Abono)` y `Pago en Efectivo en Linea 9` se reconocen como abonos. `AJUSTE PAGO DUPLICADO` conserva su carácter de cargo. En facturados se invierte el signo del monto bancario.
- Para Líder se conserva el signo de la cartola: compras positivas y pago negativo, como en los ejemplos solicitados.
- `name` conserva literalmente la descripción original, incluidos espacios, mayúsculas y puntuación. No se consulta el nombre en Wallit ni se fabrican prefijos como `TS:`.
- Cada movimiento incluye archivo y fila de origen. La salida incluye SHA-256 de las ocho fuentes utilizadas.
- Los disponibles corresponden al 02/10/2026, aunque se pida un subperíodo. Este adaptador sólo acepta subperíodos del 18/08 al 02/10/2026; no presenta estos saldos como actuales.

## Resultado de diagnóstico con los archivos entregados

| Cuenta | Disponible | Filas en el período |
|---|---:|---:|
| Corriente 8080 CLP | 2484842 | 25 |
| TC 1164 CLP | -248236 | 77 |
| TC 1164 USD | -193.46 | 30 |
| Líder 9015 CLP | 1003523 | 9 |
| Líder 9015 USD | 522.40 | 0 |

Líder USD contiene una confirmación explícita de «Sin movimientos para mostrar», limitada al filtro «Por facturar». Las nueve filas CLP también corresponden a filas visibles bajo ese filtro. No existe evidencia en esas capturas de la totalidad del historial de Líder del período solicitado. Los Excel de la carpeta `lider` corresponden a Personas ****1164/corriente y no se usan como movimientos de ****9015.

El Excel de corriente no contiene número de cuenta. La asociación a ****8080 procede de la asignación de la captura entregada; se declara en `identity_evidence`. El ejecutor en línea verifica la identidad en el portal antes de descargarla. Los disponibles de TC se extraen de sus Excel no facturados, el de corriente del Excel y los de Líder del registro `lider/saldos.md`.

## Diferencias entre ejemplos y cartolas originales

Las pruebas respetan la instrucción de usar la cartola como fuente de nombres y fechas:

| Ejemplo solicitado | Valor que figura en el archivo real |
|---|---|
| Transferencia recibida GRUPO CF E HIJOS SPA | Transferencia recibida de GRUPO CF E HIJOS SPA |
| PAC BCI SEGUROS VIDA SA | Cargo realizado por PAC de BCI SEGUROS VIDA SA |
| MERPAGO KAYAITU | MERPAGO*KAYAUNITE |
| DL GOOGLE YOUTUBE | DL*GOOGLE YOUTUBE |
| TS: TECNOMAS.CL SANTIAGO CHL | TECNOMAS.CL |
| Transferencia desde BCI, $1.240.000, 30/09 | MONTO CANCELADO, misma fecha y monto |
| TS: OpenAI - Suscripción | OPENAI |
| Pago desde BCI Corriente, US$1.263,01 | MONTO CANCELADO, misma fecha y monto |
| TS: Partslink24 - Suscripción, 22/09 | `cl-870425 partslink24  Muni`, **23/09/2026**, US$33,62 |

El abono de $280.000 se devuelve exactamente como `PAGOS NACIONAL WEB (Abono)` el 28/09.


No se modificaron los cron de correo ni de tipo de cambio.
