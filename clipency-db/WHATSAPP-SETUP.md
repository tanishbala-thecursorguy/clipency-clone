# Automatic WhatsApp to new inquiries: setup

Everything on Clipency's side is built: function `lead-welcome` and job `cx_lead_welcome`. WhatsApp starts sending once the four steps below are done. Until then, inquiries get the **email only**, and WhatsApp is marked "not connected yet".

WhatsApp only allows this through Meta's **WhatsApp Business Platform** (the Cloud API). Automating a normal personal WhatsApp breaks WhatsApp's rules and gets the number banned, so we don't do that.

## 1. Business account and number (Meta)

1. Open business.facebook.com and create or choose the **Clipency** business. Fill in the business details. Verification may ask for GST or company documents.
2. Go to developers.facebook.com → **Create app** → type **Business** → add the **WhatsApp** product, linked to the Clipency business.
3. **Add phone number** and enter `+91 89780 59484`.
   - **If that number runs the WhatsApp Business app:** choose the option to keep using the app ("coexistence"), if Meta offers it for your number. You keep chatting on your phone, and the API can send too.
   - **If it's a personal WhatsApp:** it has to move to the platform, and you lose the normal app on that number. Many teams use a second number for this instead.
4. Set the display name: **Clipency**.

## 2. Message template (Meta must approve it)

The first message to someone who hasn't messaged you must be an approved **template**. It can't be a voice note. Create it in WhatsApp Manager → **Message templates**:

- **Name:** `clipency_welcome`
- **Category:** Utility. If Meta rejects that, use Marketing.
- **Language:** English (`en`)
- **Body:**
  > Hi {{1}}, this is Tanish, co-founder of Clipency 👋 Thank you for your inquiry on our website. Here's the link to book a call so we can discuss further: {{2}}. Looking forward to speaking with you!
- **Sample values:** `{{1}}` = Asha, `{{2}}` = your booking link

Approval usually takes minutes to a day.

**Voice notes:** once the person replies, you can send them voice notes freely for 24 hours, from the app on your phone (with coexistence) or later from the console.

## 3. A permanent access token

In Business settings → **System users**:
1. Add a system user (Admin).
2. Assign it the WhatsApp app and the WhatsApp account.
3. **Generate token** with `whatsapp_business_messaging` and `whatsapp_business_management`, and set **expiry: never**.

From WhatsApp → API setup, copy the **Phone number ID**. This is not the phone number itself.

## 4. Put the values into Supabase (never into chat)

Supabase → Edge Functions → **Secrets**:

| Name | Value |
|---|---|
| `BOOKING_URL` | Your booking link. **Required: nothing is sent without it** |
| `WHATSAPP_TOKEN` | The permanent token from step 3 |
| `WHATSAPP_PHONE_NUMBER_ID` | The Phone number ID from step 3 |

Optional: `WHATSAPP_TEMPLATE` (default `clipency_welcome`) and `LEAD_EMAIL_FROM` (default `Tanish from Clipency <tanish@clipency.in>`).

## Who gets what

| | Email from tanish@clipency.in | WhatsApp |
|---|---|---|
| Any new inquiry | ✓ within ~5 min | – |
| …gave a WhatsApp number and ticked "message me on WhatsApp" | ✓ | ✓ within ~5 min, if it was in the last 48 hours |
| Inquiries from before this went live | – | – |

Each person is messaged once. A failed send retries up to 3 times. Staff can see what was sent in `cx_lead_outreach`.
