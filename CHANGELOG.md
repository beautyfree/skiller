# Changelog

## [0.2.15](https://github.com/beautyfree/skiller/compare/v0.2.14...v0.2.15) (2026-05-31)


### Bug Fixes

* **ci:** gate release PR creation on existing baseline tag ([daa31db](https://github.com/beautyfree/skiller/commit/daa31dbc1070eec4a96bd655894ff5a24f479a8b))
* **ci:** skip release PR updates until baseline release is published ([d8dbc75](https://github.com/beautyfree/skiller/commit/d8dbc754e4d81cd3c09ee01edff89f7692f59827))
* **ci:** split release-please PR and release workflows ([ed1edb8](https://github.com/beautyfree/skiller/commit/ed1edb87dba39d73e11b5ff8f720a1ba0bb0258e))
* **ci:** use grep in release baseline tag gate ([8077ac0](https://github.com/beautyfree/skiller/commit/8077ac074f6e344ac46e97203ece446234cd31f2))
* **scanner:** detect skills in nested directories ([93db073](https://github.com/beautyfree/skiller/commit/93db07367b8efe864f43bc1d248893df4b249c9c))
* **scanner:** detect skills in nested directories ([4f6289d](https://github.com/beautyfree/skiller/commit/4f6289d02daf80f181b2d786a6b45e5db9d134a3)), closes [#23](https://github.com/beautyfree/skiller/issues/23)

## [0.2.14](https://github.com/beautyfree/skiller-desktop-skills-manager/compare/v0.2.13...v0.2.14) (2026-04-22)


### Bug Fixes

* **ci:** re-enable release-please on release PR merges ([11785fd](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/11785fdd01fb406f9e0e867661c882559f5db26a))
* **updater:** make update downloads non-blocking and announce new version ([f6c292e](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/f6c292e9290cf12d0d524b364ba2ee35233e0b25))

## [0.2.13](https://github.com/beautyfree/skiller-desktop-skills-manager/compare/v0.2.12...v0.2.13) (2026-04-22)


### Features

* **telemetry:** add PostHog analytics with runtime opt-out control ([a16baff](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/a16baffb39870651b045b50c30e921fdb7a6c038))


### Bug Fixes

* **deps:** pin matching React and React DOM versions ([2122ada](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/2122ada8858d62353c0b02d935b2e8edc689708c))

## [0.2.12](https://github.com/beautyfree/skiller-desktop-skills-manager/compare/v0.2.11...v0.2.12) (2026-04-22)


### Features

* **app:** add GitHub star prompt and migrate app data paths ([a5f10a5](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/a5f10a58f3dd1fa38e4a98ecf9dd2f4211f297ef))

## [0.2.11](https://github.com/beautyfree/skiller-desktop-skills-manager/compare/v0.2.10...v0.2.11) (2026-04-21)


### Features

* **agents:** add 28 agents from vercel-labs/skills + project_skills_dir ([ada55ec](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/ada55ec5634ae6a8d97981835e1673fe0dd0108d))
* **onboarding:** add informational wizard with Skiller branding ([5aa98b4](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/5aa98b4291d5b9f9c056945e22240c6a88df4d53))
* **projects:** add project-scope installs with folder tree sidebar ([40995c4](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/40995c4ff2688574be5ffc8b05c4271d657ebbd6))
* **skills:** per-agent lifecycle with bulk ops and smart Remove ([335ab3f](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/335ab3f1e31d9a015e92f49de9cdaa56fbcbb586))
* **updater:** show progress bar while download is running ([e2ac03b](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/e2ac03b5c48194e74839e25589ed5808b31f118b))


### Bug Fixes

* **updater:** adopt returned snapshot so "Restart & install" shows at once ([7b43a21](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/7b43a21ecc470a6927531c473bfe5553c59e5f22))
* **updater:** show update errors as a persistent destructive panel ([f799df7](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/f799df7ccfd36dc4ebcf33882694b365720451a7))
* **updater:** surface download failures and dev-mode no-op in UI ([ca36927](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/ca36927457738092fc88e98d8dc9777bfd75c1bb))


### Documentation

* mention macOS Intel build in README + landing ([fa9acba](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/fa9acbabd4e08dcef6ba293d6119f49f9dd2d999))
* refresh README with new features and full agent list ([f5a9f33](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/f5a9f336ee49de78e47934f7a6dc7db3ce10dfff))
* update landing &lt;title&gt; to match h1 tagline ([f079a8d](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/f079a8d626000e171f51be5e9594d7f7d08c5d35))


### Refactors

* drop unreleased cross-device sync feature ([033ec9f](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/033ec9f576d7e8deabb5722a6c47ca36ccf824ab))

## [0.2.10](https://github.com/beautyfree/skiller-desktop-skills-manager/compare/v0.2.9...v0.2.10) (2026-04-21)


### Features

* **updater:** show progress bar while download is running ([e2ac03b](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/e2ac03b5c48194e74839e25589ed5808b31f118b))


### Bug Fixes

* **updater:** adopt returned snapshot so "Restart & install" shows at once ([7b43a21](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/7b43a21ecc470a6927531c473bfe5553c59e5f22))
* **updater:** show update errors as a persistent destructive panel ([f799df7](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/f799df7ccfd36dc4ebcf33882694b365720451a7))
* **updater:** surface download failures and dev-mode no-op in UI ([ca36927](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/ca36927457738092fc88e98d8dc9777bfd75c1bb))

## [0.2.9](https://github.com/beautyfree/skiller-desktop-skills-manager/compare/v0.2.8...v0.2.9) (2026-04-21)


### Features

* **agents:** add 28 agents from vercel-labs/skills + project_skills_dir ([ada55ec](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/ada55ec5634ae6a8d97981835e1673fe0dd0108d))
* **onboarding:** add informational wizard with Skiller branding ([5aa98b4](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/5aa98b4291d5b9f9c056945e22240c6a88df4d53))
* **projects:** add project-scope installs with folder tree sidebar ([40995c4](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/40995c4ff2688574be5ffc8b05c4271d657ebbd6))
* **skills:** per-agent lifecycle with bulk ops and smart Remove ([335ab3f](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/335ab3f1e31d9a015e92f49de9cdaa56fbcbb586))


### Documentation

* refresh README with new features and full agent list ([f5a9f33](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/f5a9f336ee49de78e47934f7a6dc7db3ce10dfff))


### Refactors

* drop unreleased cross-device sync feature ([033ec9f](https://github.com/beautyfree/skiller-desktop-skills-manager/commit/033ec9f576d7e8deabb5722a6c47ca36ccf824ab))
