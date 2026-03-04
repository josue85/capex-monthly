const axios = require('axios');
require('dotenv').config();

const JIRA_DOMAIN = process.env.JIRA_DOMAIN;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

const STORY_POINTS_FIELD = 'customfield_10036';
const CODE_REVIEWER_FIELD = 'customfield_10040';
const TEST_ENGINEER_FIELD = 'customfield_10042';
const EPIC_LINK_FIELD = 'customfield_10014';

const getJiraClient = () => {
    return axios.create({
        baseURL: `https://${JIRA_DOMAIN}/rest/api/3`,
        auth: {
            username: JIRA_EMAIL,
            password: JIRA_API_TOKEN,
        },
        headers: {
            'Accept': 'application/json'
        }
    });
};

// Map of Epic Key -> Epic Name to avoid repeated API calls
const epicCache = {};

async function getEpicName(client, epicKey) {
    if (!epicKey) return 'No Epic';
    if (epicCache[epicKey]) return epicCache[epicKey];

    try {
        const response = await client.get(`/issue/${epicKey}?fields=summary`);
        const name = response.data.fields.summary;
        epicCache[epicKey] = name;
        return name;
    } catch (error) {
        console.error(`Error fetching epic ${epicKey}:`, error.message);
        return epicKey; // Fallback to key
    }
}

async function fetchCapExData(projectKey, year, month, managerName) {
    const client = getJiraClient();
    
    // Construct dates for JQL. e.g. "2023-10-01" to "2023-10-31"
    const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0];
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];

    const jql = `project = "${projectKey}" AND statusCategory = Done AND resolved >= "${startDate}" AND resolved <= "${endDate}"`;
    
    console.log(`Fetching Jira data with JQL: ${jql}`);

    try {
        const response = await client.post('/search/jql', {
            jql,
            maxResults: 1000,
            fields: ['summary', 'issuetype', 'assignee', 'description', 'parent', STORY_POINTS_FIELD, CODE_REVIEWER_FIELD, TEST_ENGINEER_FIELD, EPIC_LINK_FIELD]
        });

        const issues = response.data.issues;
        
        // Structure: userEmail -> { epicName: { design: 0, dev: 0, qa: 0, total: 0 }, totalPoints: 0 }
        const userStats = {};
        const uniqueEpics = new Set();

        const addPoints = (user, epicName, category, points) => {
            if (!user) return; // Skip if no user assigned
            const email = user.emailAddress || user.displayName;
            
            if (!userStats[email]) {
                userStats[email] = { epics: {}, totalPoints: 0, displayName: user.displayName };
            }
            if (!userStats[email].epics[epicName]) {
                userStats[email].epics[epicName] = { Design: 0, Development: 0, QA: 0 };
            }
            
            userStats[email].epics[epicName][category] += points;
            userStats[email].totalPoints += points;
        };

        for (const issue of issues) {
            const fields = issue.fields;
            const points = fields[STORY_POINTS_FIELD] || 0;
            
            // Skip issues without points as they don't contribute to the math
            if (points === 0) continue;

            const assignee = fields.assignee;
            const reviewer = fields[CODE_REVIEWER_FIELD];
            const tester = fields[TEST_ENGINEER_FIELD];
            const isSpike = fields.issuetype && fields.issuetype.name.toLowerCase().includes('spike');
            const description = fields.description ? JSON.stringify(fields.description).toLowerCase() : '';
            
            // Determine if it's design. If "design" is in description, or it's a spike
            const isDesign = isSpike || description.includes('design');
            
            // Get Epic Name
            const epicKey = fields[EPIC_LINK_FIELD] || (fields.parent ? fields.parent.key : null);
            const epicName = await getEpicName(client, epicKey);

            if (epicName !== 'No Epic') {
                uniqueEpics.add(epicName);
            }

            if (isDesign) {
                // Assignee gets design points
                addPoints(assignee, epicName, 'Design', points);
            } else {
                // Assignee gets development points
                addPoints(assignee, epicName, 'Development', points);
            }

            // Reviewer gets 1 point for Development (as requested)
            if (reviewer) {
                addPoints(reviewer, epicName, 'Development', 1);
            }

            // Tester gets the story points for QA Testing
            if (tester) {
                addPoints(tester, epicName, 'QA', points);
            }
        }

        // Helper to round to nearest 5%
        const roundToNearest5 = (value) => {
            return (Math.round(value / 5) * 5).toFixed(0);
        };

        // Helper to extract Lastname, Firstname
        const formatName = (fullName) => {
            if (!fullName) return '';
            const parts = fullName.trim().split(' ');
            if (parts.length === 1) return parts[0];
            const lastName = parts.pop();
            const firstNames = parts.join(' ');
            return `${lastName}, ${firstNames}`;
        };

        // Now calculate percentages
        const finalRows = [];

        for (const [email, stats] of Object.entries(userStats)) {
            for (const [epicName, categories] of Object.entries(stats.epics)) {
                // Percentage of their total monthly capacity
                const rawDevPercent = (categories.Development / stats.totalPoints) * 100;
                const rawQaPercent = (categories.QA / stats.totalPoints) * 100;
                const rawDesignPercent = (categories.Design / stats.totalPoints) * 100;

                const devPercent = roundToNearest5(rawDevPercent);
                const qaPercent = roundToNearest5(rawQaPercent);
                const designPercent = roundToNearest5(rawDesignPercent);

                finalRows.push({
                    Person: formatName(stats.displayName),
                    Project: epicName,
                    Design: `${designPercent}%`,
                    Development: `${devPercent}%`,
                    QA: `${qaPercent}%`,
                    Training: '0%',
                    ProjectManagement: '0%',
                    ProjectOversight: '0%',
                    RawPoints: { ...categories, totalPersonPointsMonth: stats.totalPoints }
                });
            }
        }

        // Add Manager with 10% Project Management for each unique epic
        for (const epicName of uniqueEpics) {
            finalRows.push({
                Person: managerName || 'Manager, Name', 
                Project: epicName,
                Design: '0%',
                Development: '0%',
                QA: '0%',
                Training: '0%',
                ProjectManagement: '10%',
                ProjectOversight: '0%',
                RawPoints: { Design: 0, Development: 0, QA: 0, totalPersonPointsMonth: 0, generated: true }
            });
        }

        return finalRows;

    } catch (error) {
        console.error('Error fetching Jira data:', error.response ? error.response.data : error.message);
        throw error;
    }
}

module.exports = { fetchCapExData };
