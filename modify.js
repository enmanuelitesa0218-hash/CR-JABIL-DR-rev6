const fs = require('fs');

let content = fs.readFileSync('app.js', 'utf-8');

// Reemplazar window.db.ref por getDbRef
content = content.replace(/window\.db\.ref\((.*?)\)/g, 'getDbRef($1)');

const header = `window.currentSiteId = localStorage.getItem("jabil_current_site") || null;

window.getDbRef = function(path) {
    if (!window.currentSiteId) return window.db.ref('unassigned/' + path);
    return window.db.ref("sites/" + window.currentSiteId + "/" + path);
};

`;

fs.writeFileSync('app.js', header + content, 'utf-8');
console.log('Modified app.js successfully');
