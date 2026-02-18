# Page snapshot

```yaml
- generic [ref=e4]:
  - generic [ref=e5]:
    - generic [ref=e7]: 💰
    - heading "Crea tu cuenta" [level=1] [ref=e8]
    - paragraph [ref=e9]: Comienza a seguir tus gastos
  - generic [ref=e10]:
    - generic [ref=e11]:
      - generic [ref=e12]:
        - generic [ref=e13]: Email
        - textbox "Email" [ref=e14]:
          - /placeholder: you@example.com
      - generic [ref=e15]:
        - generic [ref=e16]: Contraseña
        - textbox "Contraseña" [ref=e17]:
          - /placeholder: Mínimo 8 caracteres
        - paragraph [ref=e18]: Debe tener al menos 8 caracteres
    - button "Crear cuenta" [ref=e19] [cursor=pointer]
  - paragraph [ref=e20]:
    - text: ¿Ya tienes cuenta?
    - link "Iniciar sesión" [ref=e21] [cursor=pointer]:
      - /url: /login
```