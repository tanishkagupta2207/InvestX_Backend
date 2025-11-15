const router = require("express").Router();
const Company = require("../models/Company");
const MutualFund = require("../models/MutualFund");
const Orders = require("../models/Orders");
const fetchUser = require("../middleware/fetchUser");

// Data Fetching API Endpoint
router.post("/fetch", fetchUser, async (req, res) => {
    let success = false;
    // Extract filter parameters
    const { order_type, order_sub_type, status, time_in_force, security_type } = req.body;

    try {
        const userId = req.user.id;
        const queryConditions = { user_id: userId };

        // --- 1. Build Query Conditions ---
        if (order_type) {
            queryConditions.order_type = order_type;
        }
        if (order_sub_type) {
            queryConditions.order_sub_type = order_sub_type;
        }
        if (status) {
            queryConditions.status = status;
        }
        if (time_in_force) {
            queryConditions.time_in_force = time_in_force;
        }
        if (security_type) {
            if (security_type === 'company' || security_type === 'mutualfund') {
                queryConditions.security_type = security_type;
            } else {
                return res.status(400).json({ success: false, msg: "Invalid security_type filter. Must be 'company' or 'mutualfund'." });
            }
        }

        const orders = await Orders.find(queryConditions).lean().sort({ date: -1 });
        
        if (orders.length === 0) {
            return res.json({ success: true, orders: [] });
        }

        // --- 2. Efficiently Fetch Security Details ---
        // Get unique, stringified IDs from orders for lookup
        const companyIds = orders
            .filter(o => o.security_type === 'company')
            .map(o => o.security_id);
        const mutualFundIds = orders
            .filter(o => o.security_type === 'mutualfund')
            .map(o => o.security_id);

        // Fetch all necessary security details in parallel
        const [companies, mutualFunds] = await Promise.all([
            // Select the name, symbol, and _id fields
            Company.find({ _id: { $in: companyIds } }, 'name symbol _id').lean(),
            MutualFund.find({ _id: { $in: mutualFundIds } }, 'name fund_house _id ').lean()
        ]);

        // Create a single map for quick lookup: { 'security_id_string': { name: '...', identifier: '...' } }
        const securityMap = new Map();
        
        // Populate map: Use toString() to ensure the ObjectId key is stored as a string
        companies.forEach(c => securityMap.set(c._id.toString(), { name: c.name, identifier: c.symbol }));
        mutualFunds.forEach(mf => securityMap.set(mf._id.toString(), { name: mf.name, identifier: mf.fund_house }));

        // --- 3. Map Details back to Orders ---
        const ordersWithDetails = orders.map(order => {
            // CRITICAL FIX: Use toString() on the ID from the order object when doing the lookup
            const details = securityMap.get(order.security_id.toString());
            
            return {
                ...order,
                // Map the fields used in your frontend component (OrderTable.jsx)
                name: details ? details.name : 'Unknown Security',
                security_identifier: details ? details.identifier : 'N/A',
                security_id: order.security_id.toString() // Stringify for clean JSON output
            };
        });

        success = true;
        res.json({ success, orders: ordersWithDetails });
    } catch (error) {
        console.error("Error fetching user orders:", error.message);
        res.status(500).json({ success, msg: "Internal error" });
    }
});

module.exports = router;