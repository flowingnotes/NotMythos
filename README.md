# Coding Agent Website for GitHub Pages

This is the redesigned website only. It contains static HTML, CSS, JavaScript, icons, and fonts. It does not contain the AI agent, its database, an access code, or a model.

## Publish the website

1. Extract `coding-agent-website.zip` and copy the contents of `coding-agent-website/` into your website repository. Put `index.html`, `.nojekyll`, and `assets/` in the publishing folder itself.
2. In `assets/config.js`, set `CODING_AGENT_API_ORIGIN` to the separate AI host’s public HTTPS origin, for example:

   ```js
   globalThis.CODING_AGENT_API_ORIGIN = 'https://agent.example.org';
   ```

   Do not append `/api` or put an access code, token, or other secret in this file. If the API hostname is not ready, leave it blank. Pages will still show the redesigned website with “Host not configured” and chat disabled.
3. Push the site files to your website repository and choose the branch and folder under **Settings → Pages**. For files at the root of `main`, use **Deploy from a branch → main → /(root)**. See [GitHub’s publishing instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
4. Set `CODING_AGENT_SITE_ORIGIN` on the separate AI host to the site’s origin. For a page at `https://account.github.io/project/`, set it to `https://account.github.io`, without `/project/`. For a Pages custom domain, use that exact HTTPS origin. The host’s instructions are in the separate AI Host ZIP.

Open your Pages URL to look at the design and check host status. Once the model is ready and you enter the invite code, try a prompt in Chat. Open a separate browser profile or private window to confirm it has its own conversations.

## Browser sessions

The website stores a revocable browser session credential in local storage, not the code you entered or the conversation content. Requests don’t depend on third-party cookies. A session lasts 30 days by default. History stays on the AI host. Clearing the site’s browser data loses access to that session.

Use a dedicated Pages account or a dedicated custom hostname if the same `github.io` origin would also serve other people’s or untrusted websites. The browser treats all project paths on a single origin as the same trust boundary.

The included fonts are licensed under the SIL Open Font License; see the two included license files.
