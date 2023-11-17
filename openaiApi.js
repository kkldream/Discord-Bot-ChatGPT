require("dotenv").config();
const {Configuration, OpenAIApi} = require("openai");

const msgRole = Object.freeze({
    system: "system",
    user: "user",
    assistant: "assistant",
});

const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);

async function chat(messages) {
    try {
        const completion = await openai.createChatCompletion({
            model: "gpt-3.5-turbo-1106",
            messages,
        });
        const inputCost = completion.data.usage.prompt_tokens / 1000 * 0.001;
        const outputCost = completion.data.usage.completion_tokens / 1000 * 0.002;
        const totalCost = inputCost + outputCost;
        return {
            id: completion.data.id,
            token: completion.data.usage.total_tokens,
            cost: totalCost,
            message: completion.data.choices[0].message.content,
        };
    } catch (error) {
        throw error.response.data.error;
    }
}

module.exports = {
    chat,
    msgRole,
};
