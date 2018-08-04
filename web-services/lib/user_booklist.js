/*
 * Provides API endpoints for working with book lists
 */
'use strict';
const rp = require('request-promise');

module.exports = (app, es) => {

   const url = `http://${es.host}:${es.port}/${es.users_index}/user`;

   const getUserUrl = id => `${url}/${id}`

   const getBookUrl = pgid =>
      `http://${es.host}:${es.port}/${es.books_index}/book/${pgid}`;

   const ReadStatus = Object.freeze({
      "READING": 'Reading',
      "FINISHED": 'Finished',
      "BACKLOG": 'BackLog',
      "ONHOLD": 'On-Hold',
      "DROPPED": 'Dropped'
   });


   // Add book to the user's list of books
   // status query string must be ALL CAPS, default value is READING
   // /api/user/yoshino703/books/pg703?status="READING"
   app.put('/api/user/:id/books/:pgid', async(req, res) => {
      const userUrl = getUserUrl(req.params.id);
      const userOptions = {url: userUrl, json: true};

      const bookUrl = getBookUrl(req.params.pgid);
      const bookOptions = {url: bookUrl, json: true};

      let readStatus = ReadStatus[req.query.status];
      if(readStatus === null) readStatus = ReadStatus.READING;

      try {
         // request user and book in parallel
         const [userRes, bookRes] = await Promise.all([
            rp(userOptions),
            rp(bookOptions),
         ]);

         // extract user and book info from responses
         const {_source: user, _version: version} = userRes;
         const {_source: book} = bookRes;

         const book_index = user.books.findIndex(book => book.id === req.params.pgid);
         if(book_index === -1) {
            user.books.push({
               id: req.params.pgid,
               title: book.title,
               status: readStatus
            });
         }

         // put the updated bundle back in the index
         const esResBody = await rp.put( {
            url: userUrl,
            qs: { version },
            body: user,
            json: true,
         });
         res.status(200).json(esResBody);

      } catch (esResErr) {
         res.status(esResErr.statusCode || 502).json(esResErr.error);
      }
   });

   

}