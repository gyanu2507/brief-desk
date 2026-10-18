# Checkout

POST /checkout returns 500 when promo_code is an empty string.
Blank and null promo codes should mean "no promo".
Checkout p95 is about 620ms; the promo service is the largest sync hop.
