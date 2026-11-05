# Guelph Game Dev Links

The link page for the Guelph Game Development Club, live at **[links.gryphgame.dev](https://links.gryphgame.dev)**.

It's one plain HTML page, no build step and no server. Anything pushed to `main` goes live automatically through Cloudflare Pages in about a minute.

## Updating the page

Everything is in `index.html`. You can edit it right on GitHub (open the file, click the pencil, commit) or locally and push.

**Change a link or its text:** find the button and edit the `href` and the text before `</a>`:

```html
<a class="button button-instagram" href="https://www.instagram.com/gamedev_guelph/" ...>Instagram</a>
```

**Current event:** the first button is for whatever's coming up next. Swap the link and text when there's a new event, or delete the button when there's nothing on.

**Add a button:** copy an existing one and change the class, icon and link. There are ready-made commented out buttons for the website, GitHub and email near the bottom of the list, just remove the `<!--` and `-->` around one and fill it in. Every available icon is in `images/icons/` and the matching `button-...` classes are in `css/brands.css`.

**Change the logo:** replace both `images/avatar.png` (128x128) and `images/avatar@2x.png` (256x256). The @2x one is also the image shown when the link is shared on Discord or Instagram.

## Hosting

- Hosted on **Cloudflare Pages**, connected to this repo, deploying from `main`
- Build command: none, output directory: `/`
- Custom domain `links.gryphgame.dev` is set up in the Pages project, DNS is on the club's Cloudflare account

To see past deploys or roll one back: Cloudflare dashboard > **Workers & Pages** > this project > **Deployments**.

## Testing locally

Just open `index.html` in a browser. Or with Docker: `docker compose -f docker/compose.yaml up` and go to http://localhost:8080.

## Credits

Built on [LittleLink](https://github.com/sethcottle/littlelink) by Seth Cottle, MIT licensed (see `LICENSE`).
