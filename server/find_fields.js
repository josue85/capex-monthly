const axios = require('axios');
require('dotenv').config();

const JIRA_DOMAIN = process.env.JIRA_DOMAIN; // e.g., your-domain.atlassian.net
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const ISSUE_KEY = process.env.SAMPLE_ISSUE_KEY; // e.g., PROJ-123

async function fetchIssueFields() {
  if (!JIRA_DOMAIN || !JIRA_EMAIL || !JIRA_API_TOKEN || !ISSUE_KEY) {
    console.error('Please set JIRA_DOMAIN, JIRA_EMAIL, JIRA_API_TOKEN, and SAMPLE_ISSUE_KEY in server/.env');
    return;
  }

  const url = `https://${JIRA_DOMAIN}/rest/api/3/issue/${ISSUE_KEY}?expand=names`;

  try {
    const response = await axios.get(url, {
      auth: {
        username: JIRA_EMAIL,
        password: JIRA_API_TOKEN,
      },
      headers: {
        'Accept': 'application/json'
      }
    });

    const issue = response.data;
    const fields = issue.fields;
    const names = issue.names; // Maps field keys (e.g., customfield_10001) to readable names

    console.log(`\n--- Custom Fields for ${ISSUE_KEY} ---`);
    for (const key in fields) {
      if (fields[key] !== null && names[key]) {
        // We only care about fields that have data to see what they look like
        console.log(`\nField Name: ${names[key]}`);
        console.log(`Field ID: ${key}`);
        console.log(`Value:`, JSON.stringify(fields[key], null, 2));
      }
    }

  } catch (error) {
    console.error('Error fetching issue:', error.response ? error.response.data : error.message);
  }
}

fetchIssueFields();
