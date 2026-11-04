# Pal Books on Netlify (data stored online)

## What is in this folder
- public/pal_books.html          the program (this is the web page people open)
- netlify/functions/api.mjs      the online storage and sign-in code
- netlify.toml, package.json     Netlify settings

## Deploy (Git method, easiest to keep updated)
1. Create a free account at github.com and make a new PRIVATE repository.
2. Upload everything in this folder to that repository (keep the folder structure).
3. In Netlify: Add new site -> Import an existing project -> choose the repository.
   Leave the build command empty. Netlify reads netlify.toml (publish folder: public).
4. Before the first deploy finishes, open Site configuration -> Environment variables and add:
   SESSION_SECRET = a long random text (at least 40 characters, keep it private)
   LIC_SECRET     = the secret phrase you use in the license tool (only if you sell subscriptions)
   Then trigger a new deploy.
5. Open your site address, click "Create account" and sign up.

## Deploy (command line method)
1. Install Node.js, then run:  npm install -g netlify-cli
2. In this folder run:  npm install
3. netlify login  ->  netlify init   (create a new site)
4. netlify env:set SESSION_SECRET "your long random text"
   netlify env:set LIC_SECRET "your license secret"
5. netlify deploy --prod

Note: a plain drag-and-drop of the folder on netlify.com will NOT work, because the online storage needs
the function and its package to be built.

## Moving your existing data online
On the old copy: Settings -> Export this company (.json), once for each company.
On the online site: sign in, open Settings -> Import, and choose each file.

## Selling subscriptions
Use pal_books_license_tool.html (keep it private) with the same LIC_SECRET. The online server checks the
codes, so the secret is never inside the web page.

## Good to know
- Passwords are stored as salted scrypt hashes. Sessions last 30 days. 8 wrong passwords lock the account for 15 minutes.
- Each account has one private data record. If the same account is open on two devices and one saves, the
  other is told to reload (nothing is overwritten silently).
- A backup of the previous version is kept once a day, for the last 14 days.
- Emails are not verified and there is no "forgot password" email, because that needs an email service
  (for example Resend or SendGrid). Ask for it if you want it.
- The owner of the Netlify account can read all stored data. Say so in your terms if you have customers.
- One account's data can be about 5 MB in total.
