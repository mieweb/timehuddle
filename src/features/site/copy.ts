/**
 * Every user-facing string on the public site, in one place so it can be
 * handed to translation as a unit.
 *
 * Keep it true. Each claim here is something the product does today — when a
 * feature changes, change its sentence here in the same pull request.
 */
export const SITE_COPY = {
  nav: {
    label: 'Site',
    homeLabel: 'TimeHuddle home',
    product: 'A day in it',
    redmine: 'Redmine',
    docs: 'Docs',
    releaseNotes: "What's new",
    github: 'GitHub',
    signIn: 'Sign in',
  },

  hero: {
    eyebrow: 'Open-source time tracking for teams',
    headline: ['A working day', 'has two clocks.'],
    lede: 'TimeHuddle keeps both: the shift you clock in and out of for your team, and the timers you run on each ticket. Time on Redmine issues becomes Spent time only when you send it.',
    primary: 'Start tracking',
    secondary: 'Read the guides',
    source: 'MIT licensed · view the source',
    scrubber: {
      shiftClock: 'Shift clock',
      ticketTimers: 'Ticket timers',
      at: 'Example day ·',
      notYet: 'Not clocked in yet',
      clockedOut: 'Clocked out · hours ready to send to Redmine',
      onBreak: 'Meal break — shift paused, timer closed',
      timing: 'Timing',
      clockedInNoTimer: 'Clocked in, between tickets',
      sliderLabel: 'Time of day in the example',
      shiftLane: 'Shift, with a meal break',
      ticketLane: 'Ticket timer sessions',
      breakTitle: 'Meal break',
      legendShift: 'Shift',
      legendBreak: 'Meal break',
      legendRedmine: 'Redmine issue',
      legendHuddle: 'Huddle ticket',
      hint: 'Drag across the day →',
    },
  },

  day: {
    eyebrow: 'One day, as TimeHuddle records it',
    title: 'Nothing to reconstruct on Friday.',
    intro:
      'Each line below is written down as it happens — so when the week ends, the timesheet is already there, and nobody has to remember Tuesday.',
    entries: {
      clockIn: {
        title: 'Clock in, with a plan',
        body: 'Shifts belong to a team. When a team asks for a plan first, you post it to the Huddle as you clock in, and the team’s admins see that you have started.',
        teamName: 'Platform',
        plan: 'Plan: fix the CSV export rounding, then the payroll overtime report.',
        status: 'Clocked in',
      },
      timer: {
        title: 'Start a timer from My Board',
        body: 'One timer runs at a time. Starting it posts a one-line update to the Huddle, so the team sees what you picked up without a stand-up.',
        update: 'Started',
        author: 'Dana',
        meta: 'posted automatically',
      },
      search: {
        title: 'Find the issue, wherever it lives',
        body: 'Huddle tickets and your Redmine issues sit in one table — source is a column, not a mode. The search bar takes words, an issue number, a pasted Redmine link or @name.',
        query: '#2217',
        assigned: 'Assigned to you',
        sourceHuddle: 'Huddle',
        sourceRedmine: 'Redmine',
      },
      break: {
        title: 'Take a meal break',
        body: 'A break pauses the shift and closes the running timer; resuming opens a new session. Breaks of twenty minutes or more come off the shift clock.',
        paused: 'On break since',
        resume: 'Resume',
      },
      clockOut: {
        title: 'Wrap up, clock out',
        body: 'Clocking out stops any timer still running. Forget, and TimeHuddle reminds you at four hours and near eight — then clocks you out itself at eight hours of work.',
        shift: 'Shift',
        tickets: 'Tickets',
        wrapUp: 'Wrap-up: export fixed and merged; overtime report ready for review.',
      },
      send: {
        title: 'Send the hours to Redmine',
        body: 'You see one row per issue per day before anything leaves. Confirm, and each entry is created in Redmine — never edited afterwards — then read back to check.',
        heading: 'Send work entries to Redmine',
        issue: 'Issue',
        hours: 'Hours',
        activity: 'Activity',
        activityValue: 'Development',
        confirm: 'Send 2 entries',
        neverSend: 'Never send',
        stays: '#3fa2c is a Huddle ticket — its time stays in TimeHuddle.',
      },
    },
  },

  redmine: {
    eyebrow: 'Redmine, without opening Redmine',
    quote: 'Spent time is a summary of your day — never the source of it.',
    intro:
      'Connect your own Redmine account once. Your issues appear beside your team’s tickets; you time them, create them and update them from TimeHuddle, and the hours go back when you say so.',
    points: [
      {
        title: 'Your key, your permissions',
        body: 'Each person connects with their own API key, stored encrypted and never sent back to the browser. Redmine sees you, not a service account.',
      },
      {
        title: 'Read live, never copied',
        body: 'Issues are fetched from Redmine as you look at them. Their content is not stored in TimeHuddle, and they never show up in team-wide views.',
      },
      {
        title: 'Created, never edited',
        body: 'TimeHuddle only ever adds time entries. Correcting logged time stays an administrative act in Redmine, where it belongs.',
      },
      {
        title: 'Forget Monday, lose nothing',
        body: 'Unsent days are included the next time you send, and time logged in Redmine by hand is never touched or counted twice.',
      },
    ],
    link: 'How the Redmine integration works',
  },

  team: {
    eyebrow: 'For the people who run the team',
    title: 'Oversight without a spreadsheet.',
    items: [
      {
        title: 'Join by code, link or invitation',
        body: 'A typed join code waits for an admin to approve it. A QR code or link joins straight away; an emailed invitation lasts seven days.',
      },
      {
        title: 'Changes to time go through a person',
        body: 'Editing, adding or deleting a timesheet entry is a request with a reason. Another admin on the team approves it, or declines with a note.',
      },
      {
        title: 'Who is in, right now',
        body: 'The dashboard shows teammates online and clocked in, the timers running, and today’s hours — for you, or the whole team if you’re an admin.',
      },
      {
        title: 'Settings that cascade',
        body: 'Set a default once for an enterprise or an organization; the teams below inherit it, and it can be locked so it stays that way.',
      },
    ],
    link: 'Guides for team admins',
  },

  platforms: {
    eyebrow: 'Where it runs',
    title: 'In the browser, and in your pocket.',
    body: 'The same app runs on the web and on iOS from the App Store, with over-the-air updates so a fix doesn’t wait on store review. Notifications arrive by web push, and natively on iPhone and Android.',
    appStore: 'TimeHuddle on the App Store',
    rows: [
      { label: 'Web', value: 'Any modern browser' },
      { label: 'iOS', value: 'App Store' },
      { label: 'Android', value: 'Built from the same code' },
      { label: 'Updates', value: 'Over the air' },
    ],
  },

  openSource: {
    eyebrow: 'Open source, MIT',
    title: 'Read it. Run it. Change it.',
    body: 'Every line of TimeHuddle is on GitHub — a React 19 frontend, a Meteor 3 backend and MongoDB. Run your own copy, or send a pull request to the one everybody uses.',
    runTitle: 'Run it locally',
    fullGuide: 'The full self-hosting guide',
    guidesTitle: 'Guides',
    allGuides: 'All guides',
    star: 'View on GitHub',
  },

  docs: {
    eyebrow: 'Documentation',
    title: 'Guides',
    intro:
      'How to use TimeHuddle day to day, how to run a team on it, how to connect Redmine — and how to run and change it yourself.',
    overview: 'All guides',
    browse: 'Browse the guides',
    sidebarLabel: 'Guides',
    onThisPage: 'On this page',
    pagerLabel: 'More guides',
    previous: 'Previous',
    next: 'Next',
    editOnGitHub: 'Suggest a change to this guide on GitHub',
    contribute: 'Something missing or wrong? The guides are markdown files in the repository —',
    contributeLink: 'improve them on GitHub.',
    notFoundTitle: 'No guide by that name.',
    notFoundBody: 'It may have moved. Every guide is listed on the docs index.',
  },

  footer: {
    tagline:
      'Open-source time tracking for teams: shifts, ticket timers, a team feed, and Redmine — on the web and on your phone.',
    product: 'Product',
    signIn: 'Sign in',
    releaseNotes: "What's new",
    support: 'Get help',
    docs: 'Docs',
    gettingStarted: 'Getting started',
    redmine: 'Redmine',
    selfHost: 'Run it yourself',
    source: 'Source',
    github: 'GitHub',
    issues: 'Report an issue',
    license: 'MIT license',
  },
} as const;
