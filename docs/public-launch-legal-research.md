# Public-launch legal and Google OAuth research

Last reviewed: 2026-09-04

This is an engineering research brief, not legal advice. Indonesian counsel should review the final notices and operating procedures before a broad launch.

## Indonesia Personal Data Protection Law

Indonesia's Law No. 27 of 2022 on Personal Data Protection (UU PDP) has been in force since 17 October 2022. Its two-year transition period required controllers and processors to conform by October 2024. The official text applies to processing in Indonesia and to processing outside Indonesia that has legal effects in Indonesia or affects Indonesian citizens abroad (Articles 2, 74, and 76).

The law requires processing to be limited, specific, lawful, transparent, purpose-bound, accurate, secure, and accountable. Data must be deleted or destroyed when retention ends or when the data subject requests it, unless another law requires retention (Article 16).

The privacy notice should identify the controller, legal basis, purposes, relevant data types, collected information, processing and retention periods, and data-subject rights when consent is the basis (Articles 5 and 20-22). The controller must be able to demonstrate consent where it relies on consent (Article 24).

Relevant rights include correction, access and copies, ending processing, deletion or destruction, withdrawal of consent, restriction, objection to solely automated significant decisions, and portability in a commonly used machine-readable format (Articles 6-13). Certain requests must be recorded, and several controller duties carry a three-day response period (Articles 14, 30, 32, 40, and 41).

A personal-data protection failure requires written notice to affected data subjects and the responsible institution within three days. The notice must at least identify the exposed data, when and how it was exposed, and response and recovery efforts (Article 46).

For transfers outside Indonesia, the controller must ensure equivalent protection, adequate binding safeguards, or, if neither is available, obtain the data subject's consent (Article 56). Prosepect's infrastructure therefore needs documented processor terms and transfer safeguards, not merely a sentence in the public policy.

Primary sources:

- [Official UU PDP text, Ministry of Communication and Digital Affairs](https://jdih.komdigi.go.id/produk_hukum/view/id/832/t/undangundang+nomor+27+tahun+2022)
- [Official status and metadata, BPK regulations database](https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022)

## Google API and OAuth requirements

Google requires a public production OAuth app to have a publicly accessible homepage on a verified domain. The homepage must accurately identify and describe the app, cannot be only a login page, and must link to the same privacy policy configured on the OAuth consent screen.

The privacy policy and in-product disclosures must accurately explain how the app accesses, uses, stores, and shares Google user data. Disclosures must be prominent and timely. A production app using sensitive or restricted scopes must submit those scopes for verification and provide a demonstration video showing the complete OAuth consent flow, exact requested scopes, and the functionality that uses them.

Google requires the narrowest scopes needed. Prosepect currently follows incremental authorization: basic OpenID profile scopes are requested for sign-in, while Calendar scopes are requested only when the user chooses to connect Google Calendar.

Google's Limited Use requirements restrict Google-derived data to prominent user-facing functionality. Transfers are permitted only for that functionality with consent, security, legal compliance, or a consented business transfer. Google data may not be sold, used for advertising, used for credit decisions, or routinely read by humans. Prosepect's policy and implementation must retain those limits.

Buttons that initiate Google authorization must follow Google's branding requirements. Google states that this is required for app verification and provides pre-approved web assets.

Primary sources:

- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
- [Google OAuth 2.0 Policies](https://developers.google.com/identity/protocols/oauth2/policies)
- [Google OAuth verification requirements](https://support.google.com/cloud/answer/13464321)
- [Sign in with Google branding guidelines](https://developers.google.com/identity/branding-guidelines)

## Engineering implications

Before open registration:

1. Publish a descriptive homepage, Privacy Policy, and Terms on `prosepect.com`.
2. Add an explicit Calendar-data disclosure immediately beside the connection action.
3. Use Google's approved sign-in branding.
4. Verify `prosepect.com` ownership in Google Search Console and submit brand and sensitive-scope verification with an end-to-end video.
5. Document processor agreements and international-transfer safeguards for Vercel, Render, Neon, Cloudflare, and Google.
6. Define and enforce retention periods, backup expiry, request handling, and a three-day incident-notification procedure.
7. Obtain legal review before general availability.
