# Changelog

## [0.3.3](https://github.com/beautyfree/skiller/compare/v0.3.2...v0.3.3) (2026-08-14)


### Bug Fixes

* **library:** keep selected skills in view ([d6a49ae](https://github.com/beautyfree/skiller/commit/d6a49ae5ba89b5b09b3864f428db3211a191c301))
* **release:** allow release please drafts without tags ([70bc600](https://github.com/beautyfree/skiller/commit/70bc600b840ca560df1035f6a59982b3a29cbf9b))

## [0.3.2](https://github.com/beautyfree/skiller/compare/v0.3.1...v0.3.2) (2026-08-14)


### Bug Fixes

* **desktop:** complete reconnect flow cleanly ([cf51b7f](https://github.com/beautyfree/skiller/commit/cf51b7f58d0486285da8e271155c6ad49656937c))

## [0.3.1](https://github.com/beautyfree/skiller/compare/v0.3.0...v0.3.1) (2026-08-14)


### Bug Fixes

* **desktop:** avoid background keychain prompts ([b9d85b8](https://github.com/beautyfree/skiller/commit/b9d85b8a539afb35ed0702e45914b8d5dfbf64d7))
* **release:** use root changelog in monorepo ([3e33825](https://github.com/beautyfree/skiller/commit/3e338254fa29ae218b7740ec629d84571be0cae9))

## [0.3.0](https://github.com/beautyfree/skiller/compare/v0.2.27...v0.3.0) (2026-08-14)

### Features

* Ship source-aware skill management: installed skills are reviewed by their real source, linked packages are grouped, and local changes are visible before an update or library sync.
* Add an Agent Library workflow for reviewing, selecting, saving, syncing, and removing skills without losing origin information.
* Add cached marketplace previews, complete file browsing, multiline skill summaries, and a gateway that consistently serves skills.sh content.

### Bug Fixes

* Keep reviewed secret findings explicit and value-free so an acknowledged example no longer blocks a library save, while changed findings remain blocked.
* Fix popover clipping, loading states, scroll behaviour, resizable list panes, and shared UI controls across All Skills, Marketplace, and Agent Library.

## [0.2.27](https://github.com/beautyfree/skiller/compare/v0.2.26...v0.2.27) (2026-08-07)


### Features

* add provider-neutral agent library sync ([#53](https://github.com/beautyfree/skiller/issues/53)) ([af72045](https://github.com/beautyfree/skiller/commit/af7204583123316b6f91fb6bf339fb9552d9856c))


### Bug Fixes

* **ci:** call release workflow directly ([b89183a](https://github.com/beautyfree/skiller/commit/b89183a47be38c12bd7e468b6d9061807fa5b592))
* **ci:** make release handoff deterministic ([e7d160c](https://github.com/beautyfree/skiller/commit/e7d160ce42d558affb33c5354148b4d0e468cf12))
* **release:** render and deduplicate update notes ([b116399](https://github.com/beautyfree/skiller/commit/b11639909b51efd44e4588da84817e376296b7fd))
* **ui:** polish release notes dialog ([7e4ce88](https://github.com/beautyfree/skiller/commit/7e4ce8809eb13d91e72f5c05b926c0c310a003a2))
* **ui:** polish What’s New release notes ([99e5477](https://github.com/beautyfree/skiller/commit/99e547727d6e9a46b52897517b0afa714c87b680))

## [0.2.26](https://github.com/beautyfree/skiller/compare/v0.2.25...v0.2.26) (2026-07-31)


### Features

* add skills cli compatibility and release notes ([6b48c2b](https://github.com/beautyfree/skiller/commit/6b48c2b7aa4733004b77fad2f4201c396d43e4b1))
* add Skills CLI compatibility and release notes ([cb9bff2](https://github.com/beautyfree/skiller/commit/cb9bff2056c87f92baf5fbba81b89510c7b57730))


### Bug Fixes

* **ci:** package releases without builder publishing ([e1447c4](https://github.com/beautyfree/skiller/commit/e1447c489c1091f27543ed15b779af7531f1c663))
* **ci:** package releases without builder publishing ([2224fa2](https://github.com/beautyfree/skiller/commit/2224fa252418869f55a5148452c722a19112ca96))
* **ci:** resolve draft releases with release permissions ([f5c2631](https://github.com/beautyfree/skiller/commit/f5c263124cd45ee2704f36d3de665c57d6a33f60))
* **ci:** resolve draft releases with release permissions ([cd50e2f](https://github.com/beautyfree/skiller/commit/cd50e2fe6c75f2dbe26150090225c961bfb96bee))
* **ci:** retry draft release resolution ([5339aeb](https://github.com/beautyfree/skiller/commit/5339aebb209a03bbd467d58dde05391ba2894853))
* **ci:** retry draft release resolution ([ae5d133](https://github.com/beautyfree/skiller/commit/ae5d133365f3e1f8295914e40a54d86546a9351c))
* **release:** disable electron-builder autopublish ([be1eac0](https://github.com/beautyfree/skiller/commit/be1eac0fd120549727a87f5a08c37c0e0dbc465d))
* **release:** disable electron-builder autopublish ([6d17ee7](https://github.com/beautyfree/skiller/commit/6d17ee7e165a40333aa6aeb6a80ae2691c7978b4))


### Documentation

* record release hardening evidence ([92aba4c](https://github.com/beautyfree/skiller/commit/92aba4cb20b803321ea5f8d316e7b667bb47c9bf))
* record release hardening evidence ([94c77d3](https://github.com/beautyfree/skiller/commit/94c77d351b3625bb0977a77983c4b826ddf85241))

## [0.2.25](https://github.com/beautyfree/skiller/compare/v0.2.24...v0.2.25) (2026-07-31)


### Bug Fixes

* **ci:** resolve release PR verification head ([1ace7f2](https://github.com/beautyfree/skiller/commit/1ace7f21456de1518deec2092a1118f50c52215c))
* **ci:** verify the release PR head commit ([dea6413](https://github.com/beautyfree/skiller/commit/dea64133d380248ddfb7cc69c8ab3a215d69d949))


### Documentation

* add release hardening checklist ([d7bb47b](https://github.com/beautyfree/skiller/commit/d7bb47b41c2f478000423fcebd90b592e5490d60))

## [0.2.24](https://github.com/beautyfree/skiller/compare/v0.2.23...v0.2.24) (2026-07-31)


### Bug Fixes

* **release:** make agent detection diagnosable ([ff36dc6](https://github.com/beautyfree/skiller/commit/ff36dc67ae26dc8a7084c59d12f54877ad864fc8))
* reliable releases and agent diagnostics ([109c568](https://github.com/beautyfree/skiller/commit/109c5680b5b20ab2d44d1f0c4a3ce4c3fa8ec43d))

## [0.2.23](https://github.com/beautyfree/skiller/compare/v0.2.22...v0.2.23) (2026-07-30)


### Bug Fixes

* **registry:** detect agents outside shell PATH ([#35](https://github.com/beautyfree/skiller/issues/35)) ([a6525d0](https://github.com/beautyfree/skiller/commit/a6525d059534084eddc8134393b16ba3137397da))

## [0.2.22](https://github.com/beautyfree/skiller/compare/v0.2.21...v0.2.22) (2026-07-28)


### Bug Fixes

* prevent phantom agent installs from managed skill folders ([#33](https://github.com/beautyfree/skiller/issues/33)) ([7f54fc0](https://github.com/beautyfree/skiller/commit/7f54fc0e882cf20832635e995c2048e09fdcf891))

## [0.2.21](https://github.com/beautyfree/skiller/compare/v0.2.20...v0.2.21) (2026-07-28)


### Bug Fixes

* support GitHub repository subdirectory URLs ([1058ba1](https://github.com/beautyfree/skiller/commit/1058ba17314e0a8988fc4f972505f45cb5abbbc5))

## [0.2.20](https://github.com/beautyfree/skiller/compare/v0.2.19...v0.2.20) (2026-07-28)


### Features

* add batch skill uninstall ([c0b9680](https://github.com/beautyfree/skiller/commit/c0b96808273e17c8ea87baeff9dd3690e004377d))

## [0.2.19](https://github.com/beautyfree/skiller/compare/v0.2.18...v0.2.19) (2026-07-11)


### Bug Fixes

* fail stalled update downloads with manual fallback ([300a321](https://github.com/beautyfree/skiller/commit/300a321d66ee5fdf48ad16046e8d42ab9f8c4fd9))

## [0.2.18](https://github.com/beautyfree/skiller/compare/v0.2.17...v0.2.18) (2026-07-11)


### Features

* auto-download app updates by default ([6ce0871](https://github.com/beautyfree/skiller/commit/6ce0871e1e922f7d1d0195264dc519fd46b367ff))
* surface app updates in the shell ([901f378](https://github.com/beautyfree/skiller/commit/901f3782091faf5939aebce052f5562faf1f3d8f))


### Bug Fixes

* require explicit update downloads ([a03e558](https://github.com/beautyfree/skiller/commit/a03e55893a6166e09cfb20690fc36638af1c5651))

## [0.2.17](https://github.com/beautyfree/skiller/compare/v0.2.16...v0.2.17) (2026-07-10)


### Bug Fixes

* **ui:** constrain modal layouts to viewport ([de98c12](https://github.com/beautyfree/skiller/commit/de98c12b5bcfba0b37b75e938708fae66caaa1d8))
* **ui:** keep import wizard within viewport ([f2bb943](https://github.com/beautyfree/skiller/commit/f2bb943f0e335a4516457a1765b756677127001d))

## [0.2.16](https://github.com/beautyfree/skiller/compare/v0.2.15...v0.2.16) (2026-07-10)


### Documentation

* clarify typecheck guidance ([544b145](https://github.com/beautyfree/skiller/commit/544b145bf3ab641fbd3f119d1ff0911398efbda2))

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
