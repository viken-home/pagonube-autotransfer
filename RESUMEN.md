# Auto-transferencia Pago Nube — VIKEN HOME

## Qué hace
Transfiere automáticamente el saldo disponible de Pago Nube a Mercado Pago de Lucas Martin Salleras, cada ~30 minutos, sin necesidad de ninguna PC encendida.

## Dónde corre
GitHub Actions (gratuito) — `github.com/viken-home/pagonube-autotransfer`

## Cuenta destino
- Titular: Lucas Martin Salleras
- Entidad: Mercado Pago
- CBU: 0000003100092152819348

## Mantenimiento mensual (único paso)
El día 1 de cada mes llega un email a `info.vikenhome@gmail.com` recordándote renovar la sesión.

Cuando llegue ese mail, abrí PowerShell y pegá:
```
cd "C:\Users\Lucas\OneDrive\VIKEN HOME\Claude\Lucas\autotransferencia tiendanube"
.\renew-session.ps1
```
Se abre el browser → hacés login con Google Auth → listo, otro mes corriendo solo.

## Archivos del proyecto
| Archivo | Para qué sirve |
|---|---|
| `transfer.js` | Script principal de Playwright |
| `renew-session.ps1` | Renovar sesión mensualmente |
| `.env` | Credenciales locales |
| `session.json` | Sesión guardada (se crea al renovar) |
| `.github/workflows/transfer.yml` | Workflow de transferencia (cada 30 min) |
| `.github/workflows/recordatorio-sesion.yml` | Email recordatorio el día 1 de cada mes |

## Comandos útiles
```powershell
# Renovar sesión (mensual)
.\renew-session.ps1

# Probar manualmente con browser visible
node transfer.js --debug

# Correr sin browser
node transfer.js
```

## Datos técnicos
- GitHub Actions: 64 corridas/día = 1.984 min/mes (límite gratuito: 2.000)
- Sesión de TiendaNube: dura ~30 días, se auto-renueva en cada corrida de GitHub Actions
- Login 2FA: resuelto con sesión guardada como secreto encriptado en GitHub
- Pago Nube carga en iframe: `services-financials-payments-new-admin-app.tiendanube.com`

## Credenciales (NO compartir)
- TiendaNube: `info.vikenhome@gmail.com` / `LM291023`
- GitHub token: guardado como secreto `GH_PAT` en el repo
- Gmail App Password: guardado como secreto `GMAIL_APP_PASSWORD` en el repo
