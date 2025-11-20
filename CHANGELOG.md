# [1.10.0](https://github.com/obsqrbtz/goose-highlighter/compare/v1.9.3...v1.10.0) (2025-11-20)


### Bug Fixes

* lighten debounce() usage, do not do full re-render on every change ([348d64f](https://github.com/obsqrbtz/goose-highlighter/commit/348d64f35693c11e7b14edcbe59b910195974950))
* made placeholder for textarea, added outline offset ([4f32be0](https://github.com/obsqrbtz/goose-highlighter/commit/4f32be0b93b5a39dcb034b4a15bbeca05add0a1f))


### Features

* new tabbed layout ([18e167c](https://github.com/obsqrbtz/goose-highlighter/commit/18e167cb7f2e758e09b201f7eff4cdbad080774e))
* show all found words and allow jump to them (beta) ([1a4c91f](https://github.com/obsqrbtz/goose-highlighter/commit/1a4c91fd5e35cc2227a580465ba9078200200623))

## [1.9.3](https://github.com/obsqrbtz/goose-highlighter/compare/v1.9.2...v1.9.3) (2025-11-18)


### Bug Fixes

* use CSS Custom Highlight API to avoid dom modifications (fixes [#1](https://github.com/obsqrbtz/goose-highlighter/issues/1)) ([3f2bb60](https://github.com/obsqrbtz/goose-highlighter/commit/3f2bb6080ba3a9ac0599ad6594f0d877c12bb62f))

## [1.9.2](https://github.com/obsqrbtz/goose-highlighter/compare/v1.9.1...v1.9.2) (2025-11-14)


### Bug Fixes

* **highlight:** prevent creating extra <span>'s ([#1](https://github.com/obsqrbtz/goose-highlighter/issues/1)) ([affddd3](https://github.com/obsqrbtz/goose-highlighter/commit/affddd3dbc7de30100ca134ec65f4dc090275ca5))

## [1.9.1](https://github.com/obsqrbtz/goose-highlighter/compare/v1.9.0...v1.9.1) (2025-11-05)


### Bug Fixes

* remove halowen styling ([172aa75](https://github.com/obsqrbtz/goose-highlighter/commit/172aa7583b325761af43c780db4ac61dc4bda99b))

# [1.9.0](https://github.com/obsqrbtz/goose-highlighter/compare/v1.8.5...v1.9.0) (2025-10-31)


### Features

* haloween styling ([5ef380e](https://github.com/obsqrbtz/goose-highlighter/commit/5ef380e54447f45f7360dd4b7b84456aae55bfee))

## [1.8.5](https://github.com/obsqrbtz/goose-highlighter/compare/v1.8.4...v1.8.5) (2025-10-29)


### Bug Fixes

* highlight colors when multiple list have different configurations ([67577c8](https://github.com/obsqrbtz/goose-highlighter/commit/67577c89cffca1ab6d40a8913e51b7c3c6f91c85))

## [1.8.4](https://github.com/obsqrbtz/goose-highlighter/compare/v1.8.3...v1.8.4) (2025-10-28)


### Bug Fixes

* do not re-highlight when already processing highlights ([8be53f3](https://github.com/obsqrbtz/goose-highlighter/commit/8be53f32402c2f0f228ca003ef3805c5ff0b6e88))

## [1.8.3](https://github.com/obsqrbtz/goose-highlighter/compare/v1.8.2...v1.8.3) (2025-10-08)


### Bug Fixes

* stop observing when highlightting is disabled ([d7c8dbb](https://github.com/obsqrbtz/goose-highlighter/commit/d7c8dbb5f0011afe83739841218aa737794074e3))

## [1.8.2](https://github.com/obsqrbtz/goose-highlighter/compare/v1.8.1...v1.8.2) (2025-10-08)


### Bug Fixes

* do not call save() on all keypresses in textboxes ([687d7c9](https://github.com/obsqrbtz/goose-highlighter/commit/687d7c9e62f0f282ce73e86cdc62aaf275c9dafe))
* do not save anything in list settings section until presses the apply button ([0734bf3](https://github.com/obsqrbtz/goose-highlighter/commit/0734bf330824c60f0d5c4784e99660b9e652efd6))

# [1.8.0](https://github.com/obsqrbtz/goose-highlighter/compare/v1.7.2...v1.8.0) (2025-10-07)


### Features

* add collapsible sections ([a158a30](https://github.com/obsqrbtz/goose-highlighter/commit/a158a303b01416f81e69bb137b71d3369904b044))
* add websites to exception list ([915add3](https://github.com/obsqrbtz/goose-highlighter/commit/915add3a4cdbff390a4d0f7d227a4ece5fa31072))

## [1.7.2](https://github.com/obsqrbtz/goose-highlighter/compare/v1.7.1...v1.7.2) (2025-10-06)


### Bug Fixes

* do not create <mark> elements, just wrap found words in <span> and add .css styling ([6ba0d2e](https://github.com/obsqrbtz/goose-highlighter/commit/6ba0d2eb7c7346cdca3921a12d300a714439efa5))

## [1.7.1](https://github.com/obsqrbtz/goose-highlighter/compare/v1.7.0...v1.7.1) (2025-06-27)


### Bug Fixes

* unicode support in regex ([ae1cf48](https://github.com/obsqrbtz/goose-highlighter/commit/ae1cf48c53cd42e65279cf2acde1a2860d8a31ee))

# [1.7.0](https://github.com/obsqrbtz/goose-highlighter/compare/v1.6.0...v1.7.0) (2025-06-26)


### Bug Fixes

* colorbox styling ([1e704b5](https://github.com/obsqrbtz/goose-highlighter/commit/1e704b51a859845e539224aeb389a4e493d64520))
* colorbox styling ([08ad7c4](https://github.com/obsqrbtz/goose-highlighter/commit/08ad7c432541ea4240dec05a340ad0b3279ce82f))
* moved import/export to options section ([fe15965](https://github.com/obsqrbtz/goose-highlighter/commit/fe15965e89e8483f6b96eb779617053664c9d5b1))
* wordlist scrollbar styling ([b30fac5](https://github.com/obsqrbtz/goose-highlighter/commit/b30fac5deda7941035d8ae23001c998c2584c03e))


### Features

* add word search ([80d4bff](https://github.com/obsqrbtz/goose-highlighter/commit/80d4bff0b4ef7c9e97506d1fe43a827bcc4b28fd))
* added matching flags ([759307f](https://github.com/obsqrbtz/goose-highlighter/commit/759307f9834a2bbb23e963e2042b7d41d5cfda44))

# [1.6.0](https://github.com/obsqrbtz/goose-highlighter/compare/v1.5.0...v1.6.0) (2025-06-25)


### Features

* add more locales ([d97becf](https://github.com/obsqrbtz/goose-highlighter/commit/d97becfaae696e33247840090e8a752b5ed4ed72))

# [1.5.0](https://github.com/obsqrbtz/goose-highlighter/compare/v1.4.0...v1.5.0) (2025-06-24)


### Features

* updated readme (wrong commit type is intentional to trigger ci) ([aac8749](https://github.com/obsqrbtz/goose-highlighter/commit/aac87493f29293e3d3291ba899032cf62504c14c))

# [1.4.0](https://github.com/obsqrbtz/goose-highlighter/compare/v1.3.0...v1.4.0) (2025-06-24)


### Features

* set up github action for publishing extension ([9d639b6](https://github.com/obsqrbtz/goose-highlighter/commit/9d639b65a9a1bc8b926f58fa7135aac7736aca7e))
