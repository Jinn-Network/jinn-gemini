# Deploying the Jinn Presentation

This guide covers how to deploy the Jinn Slidev presentation to various platforms.

## Quick Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your-org/jinn-cli-agents&project-name=jinn-presentation&root-directory=frontend/presentation)

### Manual Vercel Deployment

1. Fork/clone this repository
2. Connect to Vercel
3. Set the **Root Directory** to `frontend/presentation`
4. Vercel will automatically detect the build settings from `vercel.json`
5. Deploy!

Your presentation will be available at: `https://your-project.vercel.app`

## Other Static Hosting Platforms

### Netlify

1. Connect your repository to Netlify
2. Set build command: `yarn build`
3. Set publish directory: `dist`
4. Set base directory: `frontend/presentation`

### GitHub Pages

```bash
# Build the presentation
yarn build

# Push the dist folder to gh-pages branch
npx gh-pages -d dist
```

### AWS S3 / CloudFront

```bash
# Build the presentation
yarn build

# Upload dist folder to S3
aws s3 sync dist/ s3://your-bucket-name --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id YOUR_DISTRIBUTION_ID --paths "/*"
```

## Custom Domain

To use a custom domain:

1. Configure your DNS to point to your hosting platform
2. Add the domain in your platform's settings
3. Update any absolute URLs in the presentation if needed

## Presenter Mode

The deployed presentation includes presenter mode:
- Main presentation: `https://your-domain.com`
- Presenter view: `https://your-domain.com/presenter`
- Overview: `https://your-domain.com/overview`

## PDF Export

To generate a PDF version for offline use:

```bash
# Install playwright for PDF export
npx playwright install

# Export to PDF
yarn export
```

The PDF will be generated as `slides-export.pdf`.

## Integration with Documentation

Add a link to your deployed presentation in your documentation:

```markdown
📖 [View the Jinn Presentation](https://your-presentation-url.vercel.app)
```

Or embed it as an iframe:

```html
<iframe 
  src="https://your-presentation-url.vercel.app" 
  width="100%" 
  height="600px"
  frameborder="0">
</iframe>
```
