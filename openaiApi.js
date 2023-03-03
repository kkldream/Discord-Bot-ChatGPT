require("dotenv").config();
const {Configuration, OpenAIApi} = require("openai");

const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

async function chat(messages) {
    try {
        const completion = await openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages,
        });
        return {
            id: completion.data.id,
            created: completion.data.created,
            usage: completion.data.usage,
            message: completion.data.choices[0].message
        };
    } catch (error) {
        throw error.response.data.error;
    }
}

module.exports = {chat};
