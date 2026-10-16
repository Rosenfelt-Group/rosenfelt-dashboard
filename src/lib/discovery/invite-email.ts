// Shared by the Copy invite email buttons and the Gmail send, so the copied text and the sent email match.
export function inviteEmail(opts: { firstName?: string; orgName?: string; projectTitle: string; link: string; minutes?: number }) {
  return `Hi ${opts.firstName || "there"},

Thanks again for the chance to help${opts.orgName ? ` ${opts.orgName}` : ""} with "${opts.projectTitle}". Before our first call, could you fill out this short questionnaire? It covers the tools you use today, who's involved, and what you've already tried, so we can spend the call on solutions instead of background.

${opts.link}

It takes about ${opts.minutes ?? 15} minutes and saves as you go, so you can stop and come back with the same link.

Thanks,
Brian`;
}

export function inviteSubject(opts: { projectTitle: string }) {
  return `Quick questionnaire before our call: ${opts.projectTitle}`;
}
