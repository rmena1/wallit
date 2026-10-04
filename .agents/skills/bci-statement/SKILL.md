---
name: bci-statement
description: Ejecutar y revisar la lectura de cartolas BCI Personas o Líder mediante scripts/bci-statement/live.mjs, con selección de banco, controles humanos y manejo de resultados. Usar para consultas bancarias de solo lectura; no importa datos a Wallit ni configura crons.
---

# Cartolas BCI Personas y Líder

Esta skill documenta el checkout `5d7fad6bf91d591303c98d8b17b6edf671fc64dd` de Wallit. Permite ejecutar el lector sin abrir su código. La entrada es `scripts/bci-statement/live.mjs`; el modo exclusivo de Líder delega en `lider-session.mjs` y `lider-extract.mjs`. La navegación es determinista con Node/Playwright; los PDF se leen con Python y `pdftotext`, sin modelos ni OCR.

## Preparar y elegir el alcance

Trabaja desde la raíz del repo (`/workspace/repos/wallit` en este checkout). Usa Node 20, Python 3 y `pdftotext` de Poppler disponibles en PATH. Instala las dependencias del lector y Chromium si faltan:

```sh
npm ci --prefix scripts/bci-statement
npm exec --prefix scripts/bci-statement -- playwright install chromium
```

Recibe las credenciales exclusivamente por variables de entorno ya provistas de forma segura. No imprimas sus valores, no los pongas en argumentos, archivos, informes ni commits. No actives `DEBUG`, `PWDEBUG`, trazas de Playwright ni registros de formularios. El ejecutor elimina esas dos variables de depuración y no pasa las credenciales al proceso de Chromium.

Reemplaza las fechas de los siguientes comandos por fechas reales `YYYY-MM-DD`, con inicio menor o igual al fin. Conserva el orden `--from` y luego `--to`; las opciones adicionales van después. El filtro de movimientos incluye ambos extremos.

| Alcance | Comando | Entorno y efecto |
|---|---|---|
| Personas | `node scripts/bci-statement/live.mjs --from YYYY-MM-DD --to YYYY-MM-DD --bank personas` | Requiere solo `BCI_PERSONAS_RUT` y `BCI_PERSONAS_CLAVE`. No abre Líder. |
| Solo Líder | `node scripts/bci-statement/live.mjs --from YYYY-MM-DD --to YYYY-MM-DD --bank lider` | Requiere solo `BCI_LIDER_RUT` y `BCI_LIDER_CLAVE`, además de `DISPLAY` con una pantalla accesible para intervención humana. No abre Personas. Siempre usa Chromium visible. |
| Ambos | `node scripts/bci-statement/live.mjs --from YYYY-MM-DD --to YYYY-MM-DD` | Requiere las cuatro variables de credenciales. Ejecuta Personas y después Líder si Personas termina bien. No está validado de punta a punta. |

Personas y el modo conjunto usan navegador sin pantalla por defecto; admiten `--headed` para mostrarlo. Esa opción no les cambia la política frente a controles humanos. No uses `--bank all`: la CLI solo admite `personas` o `lider`; omitir la opción selecciona ambos. Fechas inválidas o credenciales requeridas ausentes fallan antes de abrir Chromium. Solo Líder también falla antes de abrirlo con `MISSING_DISPLAY` si falta `DISPLAY`.

Para una rutina de un banco, pasa siempre su `--bank` explícito. No uses el modo conjunto como alternativa automática si falla un modo exclusivo.

## Ejecutar y atender controles

Inicia una sola corrida y observa stderr para conocer etapas y errores. El script descubre el ingreso desde el sitio público del banco y solo envía el login una vez por banco/sesión. Un rechazo de credenciales, una sesión expirada o un control de seguridad no autoriza a reiniciar el login.

No resuelvas ni saltes Turnstile, reCAPTCHA, hCaptcha o «no soy un robot». No recargues, abras otra sesión ni reintentes el login para evadirlos. No inyectes respuestas ni tokens.

- **Personas y modo conjunto:** al detectar el control, el lector termina con error claro (`LOGIN_CHALLENGE`; algunas páginas de validación de acceso se clasifican como `BANK_ACCESS_CHALLENGE`), código 1 y stdout vacío. Descarta también lo ya extraído de otras cuentas. Cierra contextos y navegador; no espera a una persona, incluso con `--headed`.
- **Solo Líder:** conserva la misma página abierta y escribe en stderr `LIDER_CONTROL_URL <URL exacta>`. Informa esa URL exacta a la persona y espera a que complete el control en esa ventana. La espera no tiene límite y no consume los plazos activos de las operaciones que la incorporan. No mates ni reinicies el proceso por esa espera. Sin una persona disponible, la rutina queda pendiente; no puede completar autónomamente ese paso.
- En solo Líder, el envío de credenciales ocurre como máximo una vez y después de comprobar que no hay un control pendiente. La guardia de envío queda en la sesión del navegador y rechaza otro envío con `LOGIN_ALREADY_SUBMITTED`. Si aparece un control después del envío, espera en la misma página sin volver a enviar credenciales.

**Matiz respecto de «solo después de que el control ya no esté»:** el código comprueba ausencia de un control *pendiente*, no la desaparición literal de todos sus elementos. Puede reconocer una respuesta completada o una señal de éxito aunque quede el widget visible. Un control ilegible mantiene la espera. No interpretes esto como permiso para completarlo mediante automatización.

## Qué lee y qué entrega

Personas consulta corriente terminada en 8080 (CLP) y tarjeta terminada en 1164 (CLP y USD). Verifica identidad, descargas, cantidad de filas y cobertura. Para corriente usa los últimos movimientos y excluye de la cobertura el día más antiguo, que podría estar truncado por el límite de la consulta. Para tarjetas reúne facturados, no facturados y cartolas históricas necesarias; valida los períodos y documentos. No supone que ver una fila antigua acredita todo el intervalo.

Solo Líder consulta la tarjeta terminada en 9015 en CLP y USD. Contrasta los disponibles renderizados con la respuesta bancaria, comprueba las filas por facturar y descarga estados de cuenta PDF por el selector público. Valida meses, páginas, cuadraturas y continuidad entre cartolas. Une los PDF históricos con la vista vigente por facturar; no duplica los PDF con filas facturadas del portal. Conserva la identidad documental internacional aunque sus últimos dígitos difieran de los del portal.

El disponible es el que muestra el banco al consultar, aunque se pida un período anterior o existan movimientos posteriores. No lo recalcules ni lo reescribas para calzar con una captura vieja. `captured_at` indica el momento de consulta; Líder incluye además `available_as_of`. Los montos son cadenas decimales exactas, en pesos CLP o dólares USD. Personas usa abonos positivos y cargos negativos; Líder conserva los signos de la cartola (compras positivas, pagos negativos). Conserva nombres y fechas bancarios, sin renombrarlos según Wallit.

El script no escribe en Wallit, no importa movimientos ni cambia crons. Sí produce archivos bancarios locales según el modo. No uses capturas locales como fallback ante un fallo de la consulta en línea.

## Interpretar la salida y cerrar la corrida

**Personas / conjunto:** stdout contiene un único JSON solo después de completar todas las cuentas solicitadas y cerrar recursos. Incluye `mode: live`, `banks`, `period`, `captured_at` y `accounts`, con disponibles, movimientos y evidencia de cobertura. Un fallo produce código 1, error JSON por stderr y stdout vacío; no hay resultado parcial utilizable. Intenta cerrar sesión y cierra incondicionalmente los contextos y el navegador. Borra las descargas temporales privadas. El límite global es cinco minutos; una interrupción o exceso produce `RUN_INTERRUPTED`.

**Solo Líder:** emite el JSON de resultado por stdout tras la extracción, pero conserva el navegador visible. El proceso puede seguir asociado al navegador hasta que una persona lo cierre: no confundas esa permanencia con falta de resultado. Conserva los PDF y `resultado.json` en un directorio temporal `lider-statements-*`; la salida por stdout agrega su ruta como `output_directory`. No borra ese directorio automáticamente. Mantén estos documentos fuera del repo.

En errores dentro de la sesión exclusiva de Líder, registra el error por stderr con `browser_preserved: true`, conserva la ventana para inspección y espera su cierre. Después entrega `LIDER_INCOMPLETE`, código 1 y ningún JSON de éxito por stdout. Pueden quedar descargas locales; no las presentes como extracción completa. Los errores de configuración ocurren antes de crear la sesión y no tienen una ventana que conservar.

Solo Líder incluye `complete`, `ready` y `acceptance.matches_original_available`. `ready` y esa comparación dependen de disponibles históricos fijos del código; pueden ser `false` aunque la extracción tenga `complete: true`. Informa ambos hechos sin alterar ni los disponibles actuales ni la evidencia histórica. Personas no incluye esos campos: no los exijas para interpretar su resultado.

Ante `PERIOD_NOT_VERIFIED` o `PERIOD_NOT_COVERED`, informa falta de evidencia o alcance para el período; no lo conviertas en un fallo de credenciales ni relances el login. Ante cambios de página, descargas inválidas o discrepancias de identidad/cuadratura, conserva el error y no publiques datos parciales como resultado completo.

**Limitación concreta del modo conjunto:** además de no estar validado de punta a punta, usa el lector anterior de Líder (vistas por facturar y último período facturado). Ese lector construye cuentas sin evidencia `coverage` y exige inmediatamente esa evidencia mediante `assertPeriodCoverage`. Por ello, si llega a esa comprobación, falla con `PERIOD_NOT_VERIFIED`; no equivale a ejecutar consecutivamente los dos modos exclusivos ni puede prometer hoy un resultado de cinco cuentas.

## Conservar los caminos al mantener el lector

Esta es una regla de mantenimiento para la rutina, no una capacidad del script de editarse solo: si aparece un popup, botón extra, página intermedia o camino alternativo de login o cartola, agrega soporte para esa variante sin reemplazar un camino que ya funcionaba. Si durante una corrida se adapta un flujo, deja el cambio persistido en el repo al terminar, con su validación y explicación; no lo dejes únicamente como intervención manual o parche temporal.

Conserva los caminos existentes: ingreso directo, selección de titular, entrega de sesión por JSON/formulario bancario y «Omitir» el registro explícitamente opcional de dispositivo; corriente por menú o resumen moderno; tarjetas con menú directo o «Expandir Todo» y selección intermedia de tarjeta; descargas Excel y PDF del período seleccionado. Omitir un registro opcional no equivale a omitir un control de seguridad. No registres dispositivos ni cambies las reglas de controles humanos, el alcance de Personas o los crons para resolver una variante.

Si se modifica el lector en una tarea de mantenimiento autorizada, valida los caminos afectados y sus regresiones. Las pruebas de navegación no demuestran una corrida bancaria real:

```sh
npm test --prefix scripts/bci-statement
python3 -m unittest discover -s scripts/bci-statement -p 'test_*.py' -v
```

Las pruebas Python necesitan corpus bancarios reales externos al repo. Sus ubicaciones y variables de configuración están en `scripts/bci-statement/README.md`; si faltan, informa esa limitación y no inventes documentos ni omitas pruebas para declarar éxito. Para ejecutar la consulta normal no se necesita ese corpus. No agregues credenciales, cookies, trazas, documentos bancarios ni screenshots sin trackear a los cambios.
