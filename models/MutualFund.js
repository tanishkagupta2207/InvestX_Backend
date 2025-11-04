const mongoose = require('mongoose');

const MutualFundSchema = new mongoose.Schema({
    name:{
        type: String,
        required: true
    },
    scheme_code: {
        type: String,
        required: true,
        unique: true
    },
    fund_house: {
        type: String,
        required: true
    },
    risk_category: {
        type: String,
    },
    category: {
        type: String,
        enum: ["Large_Cap", "Mid_Cap", "Small_Cap", "Flexi_Cap", "Hybrid", "Debt", "ELSS"],
        required: true
    },
    min_sip_amount:{
        type: Number,
        default: 500
    },
    date: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('mutualfund', MutualFundSchema);