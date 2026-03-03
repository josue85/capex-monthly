const { google } = require('googleapis');
const stringSimilarity = require('string-similarity');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const SPREADSHEET_ID = '1hkoNfwzdS3bmAcsSR_eB4pv8K3Lfo6d42oqPsVrEIJU';
const TOKEN_PATH = path.join(__dirname, 'token.json');

function getOAuth2Client() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = 'http://localhost:3000/api/auth/google/callback';
    
    if (!clientId || !clientSecret) {
        throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env');
    }
    
    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function getAuthUrl() {
    const oAuth2Client = getOAuth2Client();
    return oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/spreadsheets'],
        prompt: 'consent'
    });
}

async function handleAuthCallback(code) {
    const oAuth2Client = getOAuth2Client();
    const { tokens } = await oAuth2Client.getToken(code);
    await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
    return tokens;
}

async function checkAuthStatus() {
    try {
        await fs.access(TOKEN_PATH);
        return true;
    } catch (error) {
        return false;
    }
}

async function getAuth() {
    const oAuth2Client = getOAuth2Client();
    try {
        const token = await fs.readFile(TOKEN_PATH);
        oAuth2Client.setCredentials(JSON.parse(token));
        return oAuth2Client;
    } catch (err) {
        console.warn('Google OAuth token not found. User needs to authenticate.');
        return null;
    }
}

async function getValidProjects() {
    const auth = await getAuth();
    if (!auth) return [];

    const sheets = google.sheets({ version: 'v4', auth });
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Projects!C:C', // Project names are actually in column C
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) return [];

        // Filter projects that start with "NC:"
        return rows
            .map(row => row[0])
            .filter(name => name && name.trim().startsWith('NC:'));
    } catch (error) {
        console.error('Error fetching valid projects from Sheets:', error.message);
        return [];
    }
}

async function getValidPeople() {
    const auth = await getAuth();
    if (!auth) return [];

    const sheets = google.sheets({ version: 'v4', auth });
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'People!A:A', // Assuming canonical names are in People tab, column A
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) return [];

        return rows
            .map(row => row[0])
            .filter(name => name && name.trim() !== '' && name.trim() !== 'Name'); // Filter out empty and header
    } catch (error) {
        console.error('Error fetching valid people from Sheets:', error.message);
        return [];
    }
}

function matchEpicToProject(epicName, validProjects) {
    if (!validProjects || validProjects.length === 0) return epicName;
    if (!epicName || epicName === 'No Epic') return 'No Epic';

    // Find the best fuzzy match
    const matches = stringSimilarity.findBestMatch(epicName, validProjects);
    
    // If the best match is good enough (e.g. > 0.3 similarity), use it, otherwise return original
    if (matches.bestMatch.rating > 0.3) {
        return matches.bestMatch.target;
    }
    
    return epicName; // Return original if no good match
}

function matchPersonToName(personName, validPeople) {
    if (!validPeople || validPeople.length === 0) return personName;
    if (!personName) return personName;

    const matches = stringSimilarity.findBestMatch(personName, validPeople);
    
    // Use a slightly higher threshold for people to avoid weird mapping
    if (matches.bestMatch.rating > 0.4) {
        return matches.bestMatch.target;
    }
    
    return personName;
}

async function appendCapExData(rows) {
    const auth = await getAuth();
    if (!auth) throw new Error("Google Sheets authentication not configured");

    const sheets = google.sheets({ version: 'v4', auth });
    
    // Filter out rows that have 'No Epic' BEFORE formatting for export
    const validRows = rows.filter(row => row.Project !== 'No Epic');

    // Create a 2-row empty spacer
    const emptyRow = ["", "", "", "", "", "", "", "", "", ""];
    
    // Format rows to match the specific spreadsheet columns:
    // A: (Empty)
    // B: Person
    // C: Design
    // D: Coding / Development
    // E: QA Testing
    // F: (Empty - formerly Training)
    // G: Project Management
    // H: Project Oversight
    // I: (Empty)
    // J: Project
    const mappedValues = validRows.map(row => {
        // Helper to convert '0%' to ''
        const cleanZero = (val) => (val === '0%' ? '' : val);

        return [
            "",                     // A: Empty
            row.Person,             // B: Person (Last Name, First Name)
            cleanZero(row.Design),  // C: Design
            cleanZero(row.Development), // D: Coding / Development
            cleanZero(row.QA),      // E: QA Testing
            "",                     // F: Empty
            cleanZero(row.ProjectManagement), // G: Project Management
            cleanZero(row.ProjectOversight),  // H: Project Oversight
            "",                     // I: Empty
            row.Project             // J: Project
        ];
    });

    if (mappedValues.length === 0) return { success: true, message: "No valid rows to export" };

    // Prepend the empty rows to the data we are about to insert
    const values = [emptyRow, emptyRow, ...mappedValues];

    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'NetCredit!A:A', // The Sheets API uses this just to find the table. Sticking to A:A prevents it from finding an empty space further right.
            valueInputOption: 'USER_ENTERED', 
            insertDataOption: 'INSERT_ROWS', // Force it to insert rows correctly
            requestBody: {
                majorDimension: 'ROWS',
                values: values
            }
        });
        return { success: true };
    } catch (error) {
        console.error('Error writing to Sheets:', error.message);
        throw error;
    }
}

async function appendNewProjects(newProjects) {
    if (!newProjects || newProjects.length === 0) return;
    
    const auth = await getAuth();
    if (!auth) throw new Error("Google Sheets authentication not configured");

    const sheets = google.sheets({ version: 'v4', auth });

    // Format new projects
    // Column A: NetCredit, B: Feliciano, Josue, C: NC: + Project Name, D: (Blank), E: TRUE (checked), F: In Progress, J: 5
    const values = newProjects.map(proj => {
        const projectName = proj.startsWith('NC') ? proj : `NC: ${proj}`;
        return [
            "NetCredit",         // A
            "Feliciano, Josue",  // B
            projectName,         // C
            "",                  // D
            "TRUE",              // E (Checkbox)
            "In Progress",       // F
            "",                  // G
            "",                  // H
            "",                  // I
            "5"                  // J
        ];
    });

    try {
        // First find the actual last row by checking Column C
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Projects!C:C',
        });
        
        const rows = response.data.values || [];
        // Find the last index that actually has a value
        let lastRowIndex = rows.length;
        while (lastRowIndex > 0 && (!rows[lastRowIndex - 1] || !rows[lastRowIndex - 1][0] || rows[lastRowIndex - 1][0].trim() === '')) {
            lastRowIndex--;
        }
        
        const insertRow = lastRowIndex + 1;

        // Use update instead of append to put it exactly where we want it, 
        // avoiding issues with pre-formatted blank rows at the bottom of the sheet.
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `Projects!A${insertRow}:J${insertRow + values.length - 1}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                majorDimension: 'ROWS',
                values: values
            }
        });
        console.log(`Successfully appended ${newProjects.length} new projects starting at row ${insertRow}.`);
    } catch (error) {
        console.error('Error writing new projects to Sheets:', error.message);
        throw error;
    }
}

module.exports = {
    getAuthUrl,
    handleAuthCallback,
    checkAuthStatus,
    getValidProjects,
    getValidPeople,
    matchEpicToProject,
    matchPersonToName,
    appendCapExData,
    appendNewProjects
};
