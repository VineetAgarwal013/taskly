/* Seed data — works in the browser (window.SEED_TASKS) and in Node
   (module.exports) so the server can seed its SQLite database. */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.SEED_TASKS = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    return [
        { id: '1', title: 'Airpods', category: 'Items to Buy', priority: 'high', description: 'Compare prices on Amazon' },
        { id: '2', title: 'Sesame seeds', category: 'Items to Buy', priority: 'low' },
        { id: '3', title: 'Chia seeds', category: 'Items to Buy', priority: 'low' },
        { id: '4', title: 'Gond katira', category: 'Items to Buy', priority: 'med' },
        { id: '5', title: 'Comb', category: 'Items to Buy', priority: 'low' },
        { id: '6', title: 'Bucket and mug', category: 'Items to Buy', priority: 'med' },
        { id: '7', title: 'Handkerchief', category: 'Items to Buy', priority: 'low' },
        { id: '8', title: 'Make the 20 transfer', category: 'Chores / Job Hunt', priority: 'high', description: 'Transfer before bank closes' },
        { id: '9', title: 'Apply for credit card', category: 'Chores / Job Hunt', priority: 'med' },
        { id: '10', title: 'Remove WiFi', category: 'Chores / Job Hunt', priority: 'high' },
        { id: '11', title: 'August lunch colloquium register', category: 'Homework', priority: 'med' }
    ];
}));