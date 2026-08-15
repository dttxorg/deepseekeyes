# Releasing

DeepSeekEyes publishes the public scoped package `@dttxorg/deepseekeyes` from an immutable GitHub tag.

## Registry setup (one time)

In the npm package or organization settings, create a GitHub Actions trusted publisher with:

- organization/user: `dttxorg`;
- repository: `deepseekeyes`;
- workflow: `npm-publish.yml`;
- environment: `npm`.

The workflow uses short-lived GitHub OIDC identity and npm provenance. It does not require a long-lived npm token in the repository.

## Release gate

From a clean checkout of the intended release commit:

```bash
npm ci
npm run doctor
npm run eval:fixture
npm run check
npm run test:coverage
npm audit --omit=dev
npm pack --dry-run
```

Confirm that `package.json` and `CHANGELOG.md` contain the same version, then create and push `v<version>`. Publishing the matching GitHub Release runs `.github/workflows/npm-publish.yml`; the workflow rejects a release tag that does not equal `v` plus `package.json.version`.

## Registry verification

```bash
npm view @dttxorg/deepseekeyes@0.4.2 name version dist.integrity dist.tarball
npx -y @dttxorg/deepseekeyes@0.4.2 doctor
```

Verify both commands from a fresh environment before marking the GitHub Release complete.
