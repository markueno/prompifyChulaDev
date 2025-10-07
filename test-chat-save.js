// Test script to verify chat storage
const testChatSave = async () => {
  try {
    // First, let's try to login to get a token
    const loginResponse = await fetch('https://localhost/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'mark123@gmail.com',
        password: 'your-password-here' // Replace with actual password
      })
    });

    if (!loginResponse.ok) {
      console.log('Login failed:', await loginResponse.text());
      return;
    }

    const loginData = await loginResponse.json();
    console.log('Login successful:', loginData);

    // Now try to save a chat
    const chatData = {
      id: 'test-chat-' + Date.now(),
      urlId: 'test-url-id',
      description: 'Test chat message',
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello, this is a test message!'
        },
        {
          id: 'msg-2', 
          role: 'assistant',
          content: 'Hello! This is a test response.'
        }
      ],
      metadata: {
        test: true,
        timestamp: new Date().toISOString()
      }
    };

    const chatResponse = await fetch('https://localhost/api/chats', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `token=${loginData.token}`
      },
      body: JSON.stringify(chatData)
    });

    if (chatResponse.ok) {
      const result = await chatResponse.json();
      console.log('Chat saved successfully:', result);
    } else {
      console.log('Chat save failed:', await chatResponse.text());
    }

  } catch (error) {
    console.error('Test failed:', error);
  }
};

// Run the test
testChatSave();
