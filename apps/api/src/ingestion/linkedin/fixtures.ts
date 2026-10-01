/**
 * Alert emails modelled on LinkedIn's job-alert layout: a logo link and a title
 * link per card, both to /comm/jobs/view/<id> with tracking parameters, then a
 * "Company · Location" line and optional salary / chrome lines. Synthetic —
 * real emails go through `linkedin:alerts:preview --file` before a layout
 * assumption is trusted (docs/DATA_SOURCES.md).
 */

const track = '?trackingId=abc%3D%3D&amp;refId=xyz&amp;lipi=urn%3Ali%3Apage&amp;midToken=AQ&amp;trk=eml-email_job_alert_digest_01-job_card-0-jobcard_body';

const card = (
  id: string,
  title: string,
  meta: string,
  extra: string[] = [],
): string => `
<table role="presentation" width="100%"><tr>
  <td width="48"><a href="https://www.linkedin.com/comm/jobs/view/${id}/${track}"><img src="https://media.licdn.com/logo.png" alt="logo" width="48"></a></td>
  <td>
    <a href="https://www.linkedin.com/comm/jobs/view/${id}/${track}" style="color:#0a66c2;font-weight:600">${title}</a>
    <p style="margin:0">${meta}</p>
    ${extra.map((line) => `<p style="margin:0;color:#666">${line}</p>`).join('\n    ')}
  </td>
</tr></table>`;

export const ALERT_HTML = `<!DOCTYPE html><html><head><style>td{font-family:Arial}</style></head><body>
<table><tr><td><h2>Your job alert for senior frontend engineer in European Union</h2>
<p>30+ new jobs match your preferences.</p></td></tr></table>
${card('4012345678', 'Senior Frontend Engineer', 'Acme GmbH &middot; Berlin, Germany (Remote)', ['€70K/yr - €90K/yr', 'Actively recruiting', 'Easy Apply'])}
${card('4012345679', 'Staff React Developer &amp; Tech Lead', 'Globex · European Union (Hybrid)', ['3 connections work here'])}
${card('4012345680', 'Frontend Engineer (TypeScript)', 'Initech · Warsaw, Mazowieckie, Poland (On-site)', ['Be an early applicant'])}
<table><tr><td>
  <a href="https://www.linkedin.com/comm/jobs/search?keywords=senior%20frontend">See all jobs</a>
  <p>You are receiving Job Alert emails.</p>
  <a href="https://www.linkedin.com/comm/jobs/alerts?unsubscribe=1">Unsubscribe</a>
</td></tr></table>
</body></html>`;

export const ALERT_TEXT = `Your job alert for senior frontend engineer in European Union
30+ new jobs match your preferences.

Senior Frontend Engineer
Acme GmbH
Berlin, Germany (Remote)
€70K/yr - €90K/yr
Easy Apply
View job: https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc&refId=xyz

---------------------------------------------------------

Staff React Developer & Tech Lead
Globex
European Union (Hybrid)
View job: https://www.linkedin.com/comm/jobs/view/4012345679/?trackingId=abc

---------------------------------------------------------

Frontend Engineer (TypeScript)
Initech
Warsaw, Mazowieckie, Poland (On-site)
View job: https://www.linkedin.com/comm/jobs/view/4012345680/?trackingId=abc

---------------------------------------------------------

Senior UI Engineer
Umbrella
Remote
View job: https://www.linkedin.com/comm/jobs/view/4012345681/

---------------------------------------------------------

See all jobs: https://www.linkedin.com/comm/jobs/search?keywords=senior%20frontend
Unsubscribe: https://www.linkedin.com/comm/jobs/alerts?unsubscribe=1
`;
