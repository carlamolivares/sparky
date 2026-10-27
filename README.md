# Sparky the Robot Dog

A one-page site about Sparky, a Unitree Go2 robot dog who visits schools and STEM events. Visitors learn how Sparky works, then request a visit through a Microsoft Form linked at the bottom of the page.

**Live page:** https://carlamolivares.github.io/sparky/ (this is the address for the NFC tags)

## Files

| File | What it does |
| --- | --- |
| `index.html` | The page: intro, facts about Sparky, the LiDAR explainer, and the request section at the bottom |
| `styles.css` | Colors, fonts, and layout. Colors are variables at the top, with a separate set for dark mode |
| `lidar.js` | The "How Sparky sees the room" animation |
| `main.js` | Smooth scrolling for the "Request a visit" and "See how he works" links |

## Common edits

**Change the request form.** In `index.html`, search for `forms.cloud.microsoft` and replace the link.

**Add a photo of Sparky.** Put the photo in an `images` folder (for example `images/sparky.jpg`). In `index.html`, find the comment that starts with `PHOTO:` and follow it. It swaps the drawing for your photo.

**Change the wording.** All text is in `index.html`. Edit it right on GitHub with the pencil icon, and the live page updates a minute or two after you commit.

## Request form checklist

- In Microsoft Forms, go to **Collect responses** and choose **Anyone can respond**, so people outside your organization can submit.
- In the form's **Settings**, turn on **Get email notification of each response**.
- Test the link in a private or incognito window before printing NFC tags.

## Hosting

The site is served by GitHub Pages from the `main` branch. There is no build step: edit a file, commit, and the page updates.
