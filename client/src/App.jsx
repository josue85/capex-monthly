import { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [projectKey, setProjectKey] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [exportStatus, setExportStatus] = useState(null);
  const [isGoogleAuthed, setIsGoogleAuthed] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [selectedNewProjects, setSelectedNewProjects] = useState([]);

  useEffect(() => {
    // Check if the backend has Google OAuth tokens saved
    const checkAuth = async () => {
      try {
        const response = await axios.get('http://localhost:3000/api/auth/status');
        setIsGoogleAuthed(response.data.authenticated);
      } catch (err) {
        console.error("Failed to check auth status", err);
      } finally {
        setCheckingAuth(false);
      }
    };
    checkAuth();
  }, []);

  const fetchPreview = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setExportStatus(null);

    try {
      const response = await axios.post('http://localhost:3000/api/capex/preview', {
        projectKey,
        year: parseInt(year),
        month: parseInt(month)
      });
      setData(response.data);
      setSelectedNewProjects([]); // Reset on new preview
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!data) return;
    setLoading(true);
    setExportStatus(null);
    
    try {
      await axios.post('http://localhost:3000/api/capex/export', { 
        rows: data,
        newProjects: selectedNewProjects 
      });
      setExportStatus('success');
      setSelectedNewProjects([]); // Clear after successful export
    } catch (err) {
      setExportStatus('error');
      setError('Failed to export to Google Sheets: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const unmatchedProjects = data ? Array.from(new Set(
    data
      .filter(row => row.Project !== 'No Epic' && !row.Project.startsWith('NC:'))
      .map(row => row.Project)
  )) : [];

  const handleToggleNewProject = (proj) => {
    setSelectedNewProjects(prev => 
      prev.includes(proj) ? prev.filter(p => p !== proj) : [...prev, proj]
    );
  };

  return (
    <div className="min-h-screen bg-enova-bg p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="bg-white rounded-xl shadow-sm p-6 border-t-4 border-t-enova-light border-x border-b border-gray-100 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
          <div className="flex items-center gap-4">
            <img src="https://www.enova.com/wp-content/uploads/sites/3/2018/12/enova-logo.svg" alt="Enova" className="h-8" />
            <div className="h-8 w-px bg-gray-200 hidden sm:block"></div>
            <div>
              <h1 className="text-xl font-bold text-enova-dark">Monthly CapEx Generator</h1>
              <p className="text-gray-500 text-xs mt-0.5">Pull Jira data and format it for Google Sheets</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {!checkingAuth && (
              isGoogleAuthed ? (
                <div className="flex items-center gap-2 text-green-600 bg-green-50 px-3 py-1.5 rounded-full text-sm font-medium border border-green-200">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                  Google Sheets Connected
                </div>
              ) : (
                <a 
                  href="http://localhost:3000/api/auth/google"
                  className="flex items-center gap-2 bg-white text-gray-700 px-4 py-2 rounded-md text-sm font-medium border border-gray-300 hover:border-enova-light hover:text-enova-light transition-colors shadow-sm"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Connect Google Sheets
                </a>
              )
            )}
          </div>
        </header>

        <main className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <form onSubmit={fetchPreview} className="flex flex-wrap items-end gap-4 mb-8">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-enova-dark">Jira Project Key</label>
              <input
                type="text"
                required
                placeholder="e.g. NCOR"
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-enova-light focus:border-enova-light focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-enova-dark">Year</label>
              <input
                type="number"
                required
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 w-24 focus:ring-2 focus:ring-enova-light focus:border-enova-light focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-enova-dark">Month</label>
              <select
                required
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 w-36 focus:ring-2 focus:ring-enova-light focus:border-enova-light focus:outline-none bg-white"
              >
                <option value="" disabled>Select Month</option>
                <option value="1">January</option>
                <option value="2">February</option>
                <option value="3">March</option>
                <option value="4">April</option>
                <option value="5">May</option>
                <option value="6">June</option>
                <option value="7">July</option>
                <option value="8">August</option>
                <option value="9">September</option>
                <option value="10">October</option>
                <option value="11">November</option>
                <option value="12">December</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="bg-enova-dark hover:bg-enova-light text-white font-medium px-6 py-2 rounded-md transition-colors duration-200 disabled:opacity-50 shadow-sm"
            >
              {loading && !data ? 'Loading...' : 'Generate Preview'}
            </button>
          </form>

          {error && (
            <div className="bg-red-50 text-red-700 p-4 rounded-md mb-6 border border-red-200">
              {error}
            </div>
          )}

          {exportStatus === 'success' && (
            <div className="bg-green-50 text-green-700 p-4 rounded-md mb-6 border border-green-200">
              Successfully exported data to Google Sheets!
            </div>
          )}

          {data && data.length > 0 && (
            <div className="space-y-6">
              {unmatchedProjects.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-yellow-800 mb-2">
                    Unmatched Projects Detected
                  </h3>
                  <p className="text-xs text-yellow-700 mb-3">
                    The following projects could not be automatically matched to existing 'NC:' projects in the spreadsheet. 
                    Select any you'd like to append as new projects to the <strong>Projects</strong> tab.
                  </p>
                  <div className="flex flex-col gap-2">
                    {unmatchedProjects.map(proj => (
                      <label key={proj} className="flex items-center gap-2 text-sm text-gray-700 bg-white px-3 py-2 rounded border border-yellow-100 cursor-pointer hover:bg-yellow-50/50">
                        <input 
                          type="checkbox" 
                          checked={selectedNewProjects.includes(proj)}
                          onChange={() => handleToggleNewProject(proj)}
                          className="rounded border-gray-300 text-enova-light focus:ring-enova-light"
                        />
                        <span className="font-medium">{proj}</span>
                        <span className="text-gray-400 text-xs ml-auto">Will be added as: NC: {proj}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-between items-center">
                <h2 className="text-lg font-semibold text-gray-800">Preview ({data.length} rows)</h2>
                
                <div className="flex flex-col items-end gap-1">
                  <button
                    onClick={handleExport}
                    disabled={loading || !isGoogleAuthed}
                    className={`font-medium px-6 py-2 rounded-md transition-colors flex items-center gap-2 ${
                      isGoogleAuthed 
                        ? 'bg-green-600 hover:bg-green-700 text-white disabled:opacity-50' 
                        : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    {loading && exportStatus === null ? 'Exporting...' : 'Export to Sheets'}
                  </button>
                  {!isGoogleAuthed && (
                    <span className="text-xs text-red-500">Please connect Google Sheets first</span>
                  )}
                </div>
              </div>
              
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full text-left text-sm text-gray-600">
                  <thead className="bg-enova-dark text-white uppercase text-xs tracking-wider border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 min-w-[150px]">Person</th>
                      <th className="px-4 py-3 min-w-[200px]">Project (Fuzzy Matched)</th>
                      <th className="px-4 py-3">Design</th>
                      <th className="px-4 py-3">Dev</th>
                      <th className="px-4 py-3">QA</th>
                      <th className="px-4 py-3">Training</th>
                      <th className="px-4 py-3">Proj Mgmt</th>
                      <th className="px-4 py-3">Oversight</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {data.map((row, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <span className="font-medium text-gray-900">{row.Person}</span>
                          {row.OriginalPerson && row.OriginalPerson !== row.Person && (
                            <div className="text-xs text-gray-400 mt-1">Orig: {row.OriginalPerson}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={row.Project === 'No Epic' ? 'text-orange-500 italic' : ''}>
                            {row.Project}
                          </span>
                          {row.OriginalEpic && row.OriginalEpic !== row.Project && (
                            <div className="text-xs text-gray-400 mt-1">Orig: {row.OriginalEpic}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">{row.Design}</td>
                        <td className="px-4 py-3">{row.Development}</td>
                        <td className="px-4 py-3">{row.QA}</td>
                        <td className="px-4 py-3">{row.Training}</td>
                        <td className="px-4 py-3">{row.ProjectManagement}</td>
                        <td className="px-4 py-3">{row.ProjectOversight}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data && data.length === 0 && (
            <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-300">
              No completed issues found for this project and month.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
