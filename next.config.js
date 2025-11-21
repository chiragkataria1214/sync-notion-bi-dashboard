/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    MONGODB_URI: process.env.MONGODB_URI,
    NOTION_API_KEY: process.env.NOTION_API_KEY,
    NOTION_PROJECTS_DB_ID: process.env.NOTION_PROJECTS_DB_ID,
    NOTION_TEAM_MEMBERS_DB_ID: process.env.NOTION_TEAM_MEMBERS_DB_ID,
    TIMEDOCTOR_API_TOKEN: process.env.TIMEDOCTOR_API_TOKEN,
    TIMEDOCTOR_COMPANY_ID: process.env.TIMEDOCTOR_COMPANY_ID,
    SYNC_SECRET: process.env.SYNC_SECRET,
  },
}

module.exports = nextConfig

