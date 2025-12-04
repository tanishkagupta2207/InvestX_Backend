// dateUtils.js
const { DateTime } = require("luxon");

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

function getSimulatedNextDate(utcDate) {
    // Convert UTC date to ET to determine the market day
    const etDate = DateTime.fromJSDate(utcDate, { zone: "UTC" }).setZone("America/New_York");
    const etDayOfWeek = etDate.weekday; // 1=Monday ... 7=Sunday

    // Start with UTC date
    const simulatedDate = new Date(utcDate);

    // Apply weekend skipping based on ET day
    if (etDayOfWeek === 5) {          // Friday → simulate Monday
        simulatedDate.setDate(simulatedDate.getDate() + 3);
    } else if (etDayOfWeek === 6) {   // Saturday → simulate Monday
        simulatedDate.setDate(simulatedDate.getDate() + 2);
    } else if (etDayOfWeek === 7) {   // Sunday → simulate Monday
        simulatedDate.setDate(simulatedDate.getDate() + 1);
    } else {                          // Monday–Thursday → next day
        simulatedDate.setDate(simulatedDate.getDate() + 1);
    }

    return simulatedDate;
}


module.exports = { getSimulatedPrevDate, getSimulatedNextDate };