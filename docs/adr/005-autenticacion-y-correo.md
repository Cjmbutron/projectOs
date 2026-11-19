# ADR-005 — Autenticación, bloqueo por intentos y correo transaccional

**Estado:** Propuesto · **Relacionado con:** US-001, 002, 003, 005, 055; RNF-01

## Contexto

RNF-01 exige bloqueo tras 5 intentos fallidos, MFA, y US-001/003 exigen no revelar si un correo existe.
Verificado en la documentación oficial de Supabase ([Rate limits](https://supabase.com/docs/guides/auth/rate-limits),
18-nov-2026):

| Límite | Valor |
|---|---|
| Correos enviados con el proveedor integrado | **2 por hora** (configurable con SMTP propio) |
| Registro/inicio de sesión (`/signup`, `/recover`, `/otp`…) | 30 por 5 min **por IP** |
| Endpoint de token (contraseña, refresco) | 150 por 5 min **por IP** |
| Solicitud de restablecer contraseña / confirmar registro | 1 cada 60 s **por usuario** |
| Desafío y verificación MFA | 15 por minuto por IP |

La página **no menciona** un bloqueo por usuario tras varios intentos de contraseña fallidos: los límites son
por IP o por frecuencia de envío.

## Decisión propuesta

1. **Bloqueo por intentos fallidos propio.** El inicio de sesión pasa por una ruta del servidor que registra
   intentos (tabla accesible solo con la clave de servicio) y aplica el bloqueo de RNF-01, antes de llamar a
   Supabase Auth. Esto implica que el cliente **no** llama a Auth directamente para iniciar sesión.
   *Antes de implementarlo se debe revisar la configuración de Auth en la documentación del CLI de Supabase:
   si ofrece ahora un bloqueo nativo por usuario, se prefiere ese.*
2. **Correo transaccional con SMTP propio desde el inicio del desarrollo con usuarios reales.** El proveedor
   integrado (2 correos/h) sirve solo para pruebas locales. Se elige un proveedor (p. ej. Resend o Postmark;
   decisión y costo pendientes) y plantillas en español e inglés.
   > *Corrección:* una recomendación anterior de esta revisión sugería usar el SMTP de Supabase "al inicio";
   > con ese límite no es viable ni siquiera para un piloto pequeño.
3. **No revelar la existencia de un correo** (US-001/003): hay que **verificar** el comportamiento exacto de
   Supabase con la confirmación de correo activada y, si no basta, responder igual desde nuestro servidor.
4. **MFA** (US-055): TOTP de Supabase; `mfa_required` por organización se impone en RLS/servidor.

## Consecuencias

- Más código propio en el flujo de acceso, con pruebas de seguridad dedicadas.
- Los puntos 1 y 3 son los de mayor riesgo y requieren revisión humana de seguridad antes de producción.
