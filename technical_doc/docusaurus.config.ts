import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const SITE_URL: string =
  process.env.SITE_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'https://docs.dmexpro.com'   // production default
    : 'https://docs.dmexhub.com');

const config: Config = {
  title: 'DMeX Pro',
  tagline: 'Transforming Industry with Smart Manufacturing Solutions',
  favicon: 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://dmexpro.com/&size=64',

  url: SITE_URL,
  baseUrl: '/',

  organizationName: 'facebook',
  projectName: 'docusaurus',

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
        },

        blog: {
          showReadingTime: true,
          blogSidebarCount: 'ALL',
          sortPosts: 'ascending',
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },

        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  // **ADD THIS PLUGIN CONFIG TO ENABLE releaseNotes DOCS**
  plugins: [
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'releaseNotes',          // unique id for this docs plugin
        path: 'releaseNotes',        // folder containing markdown files
        routeBasePath: 'releaseNotes', // URL route path for these docs
      },
    ],
  ],

  themeConfig: {
    docs: {
      sidebar: {
        hideable: true,                // ← Enables « » toggle
        autoCollapseCategories: true, // ← Optional: collapses other categories when one is expanded
      },
    },
    image: 'img/docusaurus-social-card.jpg',
    navbar: {
      title: '',
      logo: {
        alt: 'DMeX Pro Logo',
        src: 'https://logo.dmexpro.com/asset/logo/qa/logo.png',
        href: '/', // Link to the homepage
      },
      items: [
        { to: '/docs/intro', label: 'Technical Feed', position: 'left' },
        { to: '/blog/welcome', label: 'Blogs', position: 'left' },
        { to: '/releaseNotes/welcome', label: 'Release Updates', position: 'left' },
        {
          type: 'html',
          position: 'left',
          value: `<span class="version-icon" title="Current Version 25.9">🚀 v25.9</span>`,
        },
        {
          href: 'https://www.facebook.com/DMexsolutions/',
          position: 'right',
          className: 'navbar-icon facebook-icon',
          'aria-label': 'Facebook',
        },
        {
          href: 'https://www.linkedin.com/authwall?trk=gf&trkInfo=AQE1FDiCesvALwAAAZeSFfj4lJxFbzb2FM42QsF3JJbeTt3O-By0PRrCyiAmXo4BJYAU5QK8NYRX47OecVER_QX3DRfcVQbxIZIbEFM733j55iDhcZHXa_T0zTVSAPBdw9pfBsI=&original_referer=&sessionRedirect=https%3A%2F%2Fwww.linkedin.com%2Fin%2Fdmex-solutions-4909202b8%2F',
          position: 'right',
          className: 'navbar-icon linkedin-icon',
          'aria-label': 'LinkedIn',
        },
        {
          href: 'https://www.youtube.com/@DMexSolutions?app=desktop',
          position: 'right',
          className: 'navbar-icon youtube-icon',
          'aria-label': 'YouTube',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'ABOUT US',
          items: [
            {
              html: `
                <div style="max-width: 300px;">
                  With DMeX Solutions Private Limited, you are not just investing in an Industry 4.0 system; you are investing in the future of your business.
                  Our Industry 4.0 system empowers businesses to harness the power of their data, transforming it into actionable insights that drive growth and innovation.
                </div>
              `,
            },
          ],
        },
        {
          title: 'QUICK LINKS',
          items: [
            {
              label: 'Technical Feed',
              to: '/docs/intro',
            },
            {
              label: 'Blogs',
              to: '/blog',
            },
            {
              label: 'Release Updates',
              to: '/releaseNotes/welcome',
            },
          ],
        },
        {
          title: 'CONTACT US',
          items: [
            {
              label: 'sales@dmexpro.com',
              href: 'https://mail.google.com/mail/?view=cm&fs=1&to=sales@dmexpro.com',
            },
            {
              label: '+91 93848 33180',
              href: 'tel:+919384833180',
            },
            {
              label: '+91 91502 72855',
              href: 'tel:+919150272855',
            },
            {
              label: '+91 91504 62855',
              href: 'tel:+919150462855',
            },
            {
              html: `
                <div>
                  S.F.NO.154/1B, Sreevatsa Square, 7/31A, Mettupalayam Road,<br />
                  Coimbatore, Tamil Nadu, India - 641 034
                </div>
              `,
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} <a href="https://dmexpro.com" target="_blank" rel="noopener noreferrer">DMeX Solutions Private Limited</a>. All rights reserved.`,
    },

    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
