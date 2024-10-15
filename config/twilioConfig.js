require('dotenv').config(); 

module.exports = {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    apiKey: process.env.TWILIO_API_KEY_SID,
    apiSecret: process.env.TWILIO_API_SECRET,
    // twimlAppSid: process.env.TWIML_APP_SID  // Optional for voice calls
};
