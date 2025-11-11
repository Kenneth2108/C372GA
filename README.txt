Pet Theme Auth Patch (uses ONLY your sample logic)
========================================================
This patch keeps your **exact flow** (no controllers):
- express + ejs
- mysql2
- express-session + connect-flash
- password stored/checked with **SHA1** in SQL (same as your sample)
- routes already in your app.js:
    GET /register  -> render('register', { messages, formData })
    POST /register -> INSERT users (..., SHA1(?), ...)
    GET /login     -> render('login', { error_msg, success_msg })
    POST /login    -> SELECT * FROM users WHERE email=? AND password=SHA1(?)
    GET /logout    -> destroy session and redirect '/'
    GET /manageUsers -> admin list
    POST /updateRole/:id -> admin update role

What to replace
---------------
1) Copy these files into your project:
   - views/login.ejs
   - views/register.ejs
   - views/manageusers.ejs

2) Ensure your app.js has the same routes as in your sample (it already does).
   No code changes are required to logic; only the theme/branding is updated.

3) Make sure your users table columns match your sample:
   users_id, username, email, password (SHA1 hashed), address, contact, role

That’s it — run your app and you’ll get the pet theme.
