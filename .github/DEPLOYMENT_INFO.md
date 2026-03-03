# Deployment Information

This file contains important information about the Pack50 deployment system.

## GitHub Container Registry Setup

### Making the package public (recommended for easier deployment)

1. Go to: https://github.com/users/Wess21/packages/container/pack50/settings
2. Scroll to "Danger Zone"
3. Click "Change package visibility"
4. Select "Public"
5. Confirm the change

### Or use Personal Access Token for private packages

1. Go to: https://github.com/settings/tokens/new
2. Name: `pack50-deploy`
3. Scopes: `read:packages`
4. Generate and save token

## Docker Image Tags

The GitHub Actions workflow creates the following tags:

- `latest` - Latest build from main/master branch
- `main` / `master` - Latest from specific branch
- `sha-<commit>` - Specific commit SHA
- `v1.0.0` - Semantic version tags (when you create git tags)

## Deployment Commands

### Pull latest image
```bash
docker pull ghcr.io/wess21/pack50:latest
```

### Pull specific version
```bash
docker pull ghcr.io/wess21/pack50:v1.0.0
```

### Login to GHCR (for private packages)
```bash
echo "YOUR_TOKEN" | docker login ghcr.io -u YOUR_USERNAME --password-stdin
```

## Build Process

1. Developer pushes to main/master
2. GitHub Actions automatically:
   - Builds Docker image
   - Runs tests (if configured)
   - Pushes to GHCR with multiple tags
3. VDS server pulls image and deploys

## Automated Deployment

Use the provided script for VDS deployment:

```bash
curl -fsSL https://raw.githubusercontent.com/Wess21/pack50/main/deploy-vds.sh -o deploy-vds.sh
chmod +x deploy-vds.sh
./deploy-vds.sh
```

## Useful Links

- Actions: https://github.com/Wess21/pack50/actions
- Packages: https://github.com/Wess21/packages/container/pack50
- Documentation: See DEPLOYMENT.md in repository root
