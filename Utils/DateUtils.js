// dateUtils.js

function getSimulatedPrevDate() {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    let simulatedDate = new Date(today);

    // If today is Monday, the "simulated" date is last Friday
    if (dayOfWeek === 1) {
        simulatedDate.setDate(simulatedDate.getDate() - 3); // Go back 3 days to Friday
    }
    // If today is Sunday, the "simulated" date is last Friday
    else if (dayOfWeek === 0) {
        simulatedDate.setDate(simulatedDate.getDate() - 2); // Go back 2 days to Friday
    }
    // For all other weekdays, the "simulated" date is yesterday
    else {
        simulatedDate.setDate(simulatedDate.getDate() - 1);
    }

    return simulatedDate;
}

function getSimulatedNextDate(date) {
    const today = new Date(date);
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    let simulatedDate = new Date(today);

    // If today is Saturday, the "simulated" next date is Monday
    if (dayOfWeek === 6) {
        simulatedDate.setDate(simulatedDate.getDate() + 2); // Go 2 days to Monday
    }
    // If today is Friday, the "simulated" next date is Monday
    else if (dayOfWeek === 5) {
        simulatedDate.setDate(simulatedDate.getDate() + 3); // Go 3 days to Monday
    }
    // For all other weekdays, the "simulated" date is tomorrow
    else {
        simulatedDate.setDate(simulatedDate.getDate() + 1);
    }

    return simulatedDate;
}

module.exports = { getSimulatedPrevDate, getSimulatedNextDate };