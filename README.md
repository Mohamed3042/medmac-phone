# Medmac phone page

A static shell, published with GitHub Pages. It holds no company data.
On first open it asks for a read-only GitHub key (kept only on that phone) and reads the
snapshot the PC writes into the private data repo. Built from `phone-page/` of the app repo by
`scripts/publish-phone-page.mjs`; every build passes a leak scan first.
