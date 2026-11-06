# Guelph Game Dev Links

The link page for the Guelph Game Development Club, live at **[links.gryphgame.dev](https://links.gryphgame.dev)**.

It's a plain HTML page plus a small Cloudflare Worker that counts views and clicks. There's no build step: anything pushed to `main` goes live automatically in about a minute.

## Updating the page

Everything is in `index.html`. You can edit it right on GitHub (open the file, click the pencil, commit) or locally and push.

**Change a link or its text:** find the button and edit the `href` and the text before `</a>`:

```html
<a class="button button-instagram" href="https://www.instagram.com/gamedev_guelph/" ...>Instagram</a>
```

**Current event:** the first button is for whatever's coming up next. Swap the link and text when there's a new event, or delete the button when there's nothing on.

**Add a button:** copy an existing one and change the class, icon and link. There are ready-made commented out buttons for the website, GitHub and email near the bottom of the list, just remove the `<!--` and `-->` around one and fill it in. Every available icon is in `images/icons/` and the matching `button-...` classes are in `css/brands.css`.

**Change the logo:** replace both `images/logo.png` (128x128) and `images/logo@2x.png` (256x256). The @2x one is also the image shown when the link is shared on Discord or Instagram.

## Click stats

See how many people visit and what they click at **[links.gryphgame.dev/stats](https://links.gryphgame.dev/stats)**. Any username works, the password is the `STATS_PASSWORD` secret (ask an exec).

It shows views, unique visitors, clicks per button, click rate, where visitors came from, countries and devices, for the last 7, 30 or 90 days or all time. No cookies or IP addresses are stored, see `privacy.html`.

**Track where people come from:** add `?src=` to the link you share and it shows up by name under "Where visitors came from". It's removed from the address bar once the page opens, so it doesn't get copied around.

| Where it's shared | Link to use |
| --- | --- |
| Instagram bio | `links.gryphgame.dev/?src=insta` |
| QR codes on posters | `links.gryphgame.dev/?src=qr` |
| Discord | `links.gryphgame.dev/?src=discord` |
| Anything else | `links.gryphgame.dev/?src=whatever-you-want` |

Instagram, Facebook, LinkedIn and TikTok are also detected automatically from their in-app browsers.

**Button names in the stats** are the button text, so a renamed event button shows up as a new row (handy for comparing events). To keep the same name no matter the text, add `data-track="name"` to the button.

How it works: `js/track.js` sends a small message to `/api/hit` when the page opens and when a button is clicked. `worker/index.js` saves it in a Cloudflare D1 database called `links-stats` and draws the `/stats` page.

## Hosting

- A **Cloudflare Worker** called `littlelink` (Workers & Pages in the Cloudflare dashboard), connected to this repo and deploying from `main`
- Settings live in `wrangler.toml`: the static files, the Worker in `worker/`, and the `DB` database binding
- The stats password is a secret named `STATS_PASSWORD` under the Worker's **Settings > Variables and Secrets** (it's never in the repo)
- Files listed in `.assetsignore` (like this README and the Worker code) aren't published on the site
- Custom domain `links.gryphgame.dev` is set on the Worker, DNS is on the club's Cloudflare account

To see past deploys or roll one back: Cloudflare dashboard > **Workers & Pages** > `littlelink` > **Deployments**.

## Testing locally

Just open `index.html` in a browser to check how it looks. To try the stats too, run `npx wrangler dev` in this folder with a `.dev.vars` file containing `STATS_PASSWORD=anything` (that file is ignored by git), then open http://localhost:8787 and http://localhost:8787/stats.

## Credits

Built on [LittleLink](https://github.com/sethcottle/littlelink) by Seth Cottle, MIT licensed (see `LICENSE.md`).
