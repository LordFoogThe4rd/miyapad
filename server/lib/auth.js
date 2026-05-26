const createAuthMiddleware = (login, password) => {
    return (req, res, next) => {
        if (!password) {
            return next();
        }

        const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
        const [reqLogin, reqPassword] = Buffer.from(b64auth, 'base64').toString().split(':');

        if (reqLogin == login && reqPassword == password) {
            return next();
        }

        res.set('WWW-Authenticate', 'Basic realm="401"');
        res.status(401).send('Authentication required.');
    };
};

module.exports = { createAuthMiddleware };
