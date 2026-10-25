# Supplied Gym Media Integration

## Placement

The homepage has a supporting media section after the product previews and before the closing CTA. It explicitly frames Gym SaaS as multi-tenant management software, not the website of a single gym. It uses the user-provided asset set's visual themes:

- Wide modern gym interior as the lead visual.
- Gym-floor/cardio image as a secondary tile.
- Training equipment, weight plates and dumbbells as supporting image tiles.
- One user-playable clip inside the gallery. Other clips are not shown in the marketing gallery to avoid making the page read as a single gym's promotional site.

The section describes the product model in its heading and copy: one management platform for many gyms, with each gym operating in its own workspace. The images are illustrative fitness context and are not presented as Gym SaaS customers, employees or facilities.

## Delivery and performance

The supplied filenames use Pexels naming conventions. The UI references the matching image/video CDN URL patterns, rather than committing copies of the attached binary files into the private repository. The available repository actions can commit text/source changes but cannot directly ingest the sandbox's binary uploads. The external CDN references should therefore be treated as a working integration step, not as self-hosted production assets.

Images use the remote Pexels image host and unoptimized image loading so the CDN's requested responsive size is used. The image section is below the fold. Videos set preload="none" and only load when a visitor plays them; they do not autoplay.

## Production recommendation

Before a broad public launch, copy the selected original files to storage controlled by the project (for example, the repository's public/media directory, a CDN/bucket owned by the project, or your established media host), update the references to those stable URLs, and check the resulting network requests. This avoids an unnecessary runtime dependency on third-party asset URLs. Also verify that all media files have the usage rights you intend; file names identify their apparent source convention, but the app does not validate licenses.
