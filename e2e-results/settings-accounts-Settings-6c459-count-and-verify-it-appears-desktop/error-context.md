# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - generic [ref=e7]: 💰
      - heading "Welcome back" [level=1] [ref=e8]
      - paragraph [ref=e9]: Sign in to continue to wallit
    - generic [ref=e10]:
      - generic [ref=e11]: Too many login attempts. Please try again later.
      - generic [ref=e12]:
        - generic [ref=e13]:
          - generic [ref=e14]: Email
          - textbox "Email" [ref=e15]:
            - /placeholder: you@example.com
            - text: e2e-1769766836049@wallit.app
        - generic [ref=e16]:
          - generic [ref=e17]: Password
          - textbox "Password" [ref=e18]:
            - /placeholder: ••••••••
            - text: testpass123
      - button "Sign in" [ref=e19] [cursor=pointer]
    - paragraph [ref=e20]:
      - text: Don't have an account?
      - link "Create one" [ref=e21] [cursor=pointer]:
        - /url: /register
  - button "Open Next.js Dev Tools" [ref=e27] [cursor=pointer]:
    - img [ref=e28]
  - alert [ref=e31]
```