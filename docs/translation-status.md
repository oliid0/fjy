# Translation coverage

English semantic keys define the schema. This report audits all 57 language catalogs against its 1575 strings, including 766 Fcboard strings and 221 factory resource titles. 55 catalogs have populated entries and intact interpolation/component contracts for every key. Coverage is separate from linguistic accuracy and physical UI validation.

The language-pen label reuses each catalog’s translated language and pen names; English and Chinese have dedicated names. Existing translations are retained. Missing or broken entries use static translation drafts, with a separate correction pass for pen, eraser and recording terminology. Hong Kong and Taiwan missing entries are converted from the Simplified Chinese catalog using OpenCC JS 1.4.2; existing regional translations remain unchanged. No translation provider is added to application runtime dependencies.

Karakalpak lacks a configured authorized translation service. Tested Kabyle services returned other languages or incorrect basic meanings; those drafts were rejected. These catalogs retain their original entries and the ordinary English fallback. Neither is reported as complete.

| Catalog | Populated | Missing | Broken contracts | Status |
| --- | --: | --: | --: | --- |
| ar-SA | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| az-AZ | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| bg-BG | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| bn-BD | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| bn-IN | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| ca-ES | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| cs-CZ | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| da-DK | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| de-CH | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| de-DE | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| el-GR | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| en | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| es-ES | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| eu-ES | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| fa-IR | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| fi-FI | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| fr-FR | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| gl-ES | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| he-IL | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| hi-IN | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| hu-HU | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| id-ID | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| it-IT | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| ja-JP | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| kaa | 348 / 1575 | 1227 | 0 | Partial |
| kab-KAB | 547 / 1575 | 1028 | 0 | Partial |
| kk-KZ | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| km-KH | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| ko-KR | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| ku-TR | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| lt-LT | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| lv-LV | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| mr-IN | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| my-MM | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| nb-NO | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| nl-NL | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| nn-NO | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| oc-FR | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| pa-IN | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| pl-PL | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| pt-BR | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| pt-PT | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| ro-RO | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| ru-RU | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| si-LK | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| sk-SK | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| sl-SI | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| sv-SE | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| ta-IN | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| th-TH | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| tr-TR | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| uk-UA | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| uz-UZ | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| vi-VN | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| zh-CN | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| zh-HK | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |
| zh-TW | 1575 / 1575 | 0 | 0 | Filled; linguistic review pending |

Preparation evidence: the [OpenCC JS converter](https://github.com/nk2028/opencc-js), [ModernMT public translation interface](https://www.modernmt.com/translate), [translatepy Google client](https://github.com/Animenosekai/translate/blob/main/translatepy/translators/google.py), and the documented [NLLB translation service](https://github.com/winstxnhdw/nllb-api). These are resource preparation sources, not new application integrations. Automated drafts require fluent-speaker review; production layout and native device behavior require CI and physical testing.
